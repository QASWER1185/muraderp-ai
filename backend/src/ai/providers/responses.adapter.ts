import {z} from "zod";
import {ApiError} from "../../errors/api-error.js";
import {decodeMedia} from "../../ai-input/document-extraction.js";
import type {AiInputRequest} from "../../ai-input/ai-input.types.js";
import type {AiProviderConfiguration,AiProviderName,AiProviderContract} from "./contracts.js";

/** Transport only: no database client or ERP tools. Provider URLs come from server configuration. */
export class ResponsesAdapter implements AiProviderContract {
  constructor(
    private readonly configuration: AiProviderConfiguration ,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get name(): AiProviderName { return this.configuration.provider ?? "openai"; }

  /** A model turn for the Copilot tool loop. The provider has no ERP access. */
  async toolTurn(instructions: string, input: unknown[], tools: unknown[], options?: { toolChoice?: "auto" | "required"; signal?: AbortSignal }): Promise<{ output: any[] }> {
    const result = await this.request("responses", JSON.stringify({
      model: this.configuration.model,
      ...(this.name === "openai" ? { store: false } : {}),
      max_output_tokens: 4096,
      instructions,
      input,
      tools,
      tool_choice: options?.toolChoice ?? "auto",
      parallel_tool_calls: false,
    }), true, options?.signal);
    if (result.status !== "completed" || !Array.isArray(result.output)) {
      throw new ApiError(502, "AI_INCOMPLETE", "Copilot reasoning did not complete. Please retry.");
    }
    return { output: result.output };
  }

  private async request(path: string, body: string | FormData, json: boolean, signal?: AbortSignal): Promise<any> {
    if (!this.configuration.apiKey) throw new ApiError(503, "AI_NOT_CONFIGURED", "AI provider is not configured. Manual entry remains available.");
    const baseUrl = this.name === "groq" ? "https://api.groq.com/openai/v1"
      : this.name === "openai" ? "https://api.openai.com/v1" : this.configuration.baseUrl;
    if (!baseUrl) throw new ApiError(503, "AI_NOT_CONFIGURED", "AI provider endpoint is not configured. Manual entry remains available.");
    const attempts = this.name === "groq" && path === "responses" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(`${baseUrl.replace(/\/$/, "")}/${path}`, {
          method: "POST", redirect: "error", signal: signal ?? AbortSignal.timeout(60_000),
          headers: { Authorization: `Bearer ${this.configuration.apiKey}`, ...(json ? { "Content-Type": "application/json" } : {}) }, body,
        });
      } catch {
        throw new ApiError(502, "AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached. Please retry.");
      }
      if (response.ok) return response.json().catch(() => { throw new ApiError(502, "AI_INVALID_OUTPUT", "AI provider returned an invalid response"); });
      // Groq occasionally fails to produce schema-conforming JSON; one fresh generation can recover.
      // Inspect only the machine-readable code. Never echo provider bodies or source documents.
      let retryable = false;
      if (this.name === "groq" && path === "responses" && response.status === 400 && attempt + 1 < attempts) {
        const providerError = await response.json().catch(() => null) as { error?: { code?: string } } | null;
        retryable = providerError?.error?.code === "json_validate_failed";
      }
      if (response.status === 429) throw new ApiError(429, "AI_PROVIDER_RATE_LIMITED", "The configured AI provider rate limit was reached. Please wait before retrying.");
      if (!retryable) throw new ApiError(502, "AI_PROVIDER_ERROR", "AI provider could not process this request. Please retry or use manual entry.");
    }
    throw new ApiError(502, "AI_PROVIDER_ERROR", "AI provider could not process this request. Please retry or use manual entry.");
  }

  async generate(schema: z.ZodType, instructions: string, content: unknown[]): Promise<unknown> {
    if (this.name === "groq" && content.some((part) => typeof part === "object" && part !== null && "type" in part && part.type === "input_file")) {
      throw new ApiError(422, "AI_INPUT_UNSUPPORTED", "PDF input is unavailable with the configured AI provider. Use an image or text input.");
    }
    // Groq vision uses Chat Completions with JSON mode, not the text-only
    // Responses transport. Validate the proposal locally in either transport.
    if (this.name === "groq" && content.some(part => part && typeof part === "object" && "type" in part && part.type === "input_image")) {
      const parts = content.map(part => {
        const value = part as { type: string; text?: string; image_url?: string };
        return value.type === "input_image" ? { type: "image_url", image_url: { url: value.image_url } } : { type: "text", text: value.text };
      });
      const result = await this.request("chat/completions", JSON.stringify({
        model: this.configuration.visionModel ?? this.configuration.model,
        messages: [{ role: "system", content: instructions + " Return JSON conforming to this schema: " + JSON.stringify(z.toJSONSchema(schema)) }, { role: "user", content: parts }],
        response_format: { type: "json_object" }, max_completion_tokens: 8000,
      }), true);
      try {
        if (result.choices?.[0]?.finish_reason !== "stop") throw new Error("Incomplete vision output");
        return schema.parse(JSON.parse(result.choices[0].message.content));
      } catch { throw new ApiError(422, "AI_INVALID_OUTPUT", "The extraction could not be validated. Please clarify or use manual entry."); }
    }
    const result = await this.request("responses", JSON.stringify({
      model: content.some((part) => typeof part === "object" && part !== null && "type" in part && part.type === "input_image")
        ? this.configuration.visionModel ?? this.configuration.model : this.configuration.model,
      ...(this.name === "openai" ? { store: false } : {}),
      max_output_tokens: 16000,
      instructions,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "erp_proposal", strict: true, schema: z.toJSONSchema(schema) } },
    }), true);
    if (result.status !== "completed") throw new ApiError(422, "AI_INCOMPLETE", "Extraction was incomplete. Use a smaller document or clarify the instruction.");
    const parts = (Array.isArray(result.output) ? result.output : []).flatMap((item: any) => item.type === "message" && Array.isArray(item.content) ? item.content : []);
    if (parts.some((part: any) => part.type === "refusal")) throw new ApiError(422, "AI_REFUSED", "The provider could not extract this input. Please use manual entry.");
    try {
      return schema.parse(JSON.parse(parts.filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("")));
    } catch {
      throw new ApiError(422, "AI_INVALID_OUTPUT", "The extraction could not be validated. Please clarify or use manual entry.");
    }
  }

  async transcribe(input: NonNullable<AiInputRequest["media"]>): Promise<string> {
    const media = decodeMedia(input);
    if (!media.mimeType.startsWith("audio/")) throw new ApiError(422, "INVALID_MEDIA", "Voice input requires an audio file");
    const form = new FormData();
    const extensions: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg" };
    form.set("file", new Blob([new Uint8Array(media.bytes)], { type: media.mimeType }), `voice.${extensions[media.mimeType]}`);
    form.set("model", this.configuration.speechModel);
    if (this.name === "groq") form.set("response_format", "verbose_json");
    const result = await this.request("audio/transcriptions", form, false);
    if (Array.isArray(result.segments) && result.segments.length && result.segments.every((segment: any) => segment.no_speech_prob >= 0.8)) {
      throw new ApiError(422, "VOICE_UNRECOGNIZED", "No usable speech was recognized. Please record again or type your request.");
    }
    const parsed = z.string().trim().min(1).max(20000).safeParse(result.text);
    if (!parsed.success) throw new ApiError(422, "VOICE_UNRECOGNIZED", "No usable speech was recognized. Please record again or type your request.");
    return parsed.data;
  }
}
