import type { z } from "zod";
import type { AiInputRequest } from "../../ai-input/ai-input.types.js";

export type AiProviderName = "openai" | "groq" | "compatible" | "gemini" | "anthropic";
export type AiProviderConfiguration = {
  provider?: AiProviderName; apiKey?: string | undefined; baseUrl?: string | undefined;
  model: string; visionModel?: string | undefined; speechModel: string;
  speechProvider?: AiProviderName | undefined; speechApiKey?: string | undefined;
  speechBaseUrl?: string | undefined;
};
export interface StructuredAiProvider {
  readonly name?: AiProviderName;
  generate(schema: z.ZodType, instructions: string, content: unknown[]): Promise<unknown>;
  transcribe(media: NonNullable<AiInputRequest["media"]>): Promise<string>;
}
/** Internal turn protocol. Adapters translate wire formats; tools remain server-owned. */
export interface ToolCallingAiProvider {
  toolTurn(instructions: string, input: unknown[], tools: unknown[], options?: {
    toolChoice?: "auto" | "required"; signal?: AbortSignal;
  }): Promise<{ output: any[] }>;
}
export interface AiProviderContract extends StructuredAiProvider, ToolCallingAiProvider {
  readonly name: AiProviderName;
}
