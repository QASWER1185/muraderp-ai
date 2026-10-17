import { describe, expect, it, vi } from "vitest";
import { AiProvider } from "../../ai-input/openai.provider.js";
import { ProviderAgentModel } from "./model.js";

describe("Groq Phase 1 model transport", () => {
  it("sends native tool definitions and preserves function calls", async () => {
    const output = [{ type: "function_call", call_id: "call-1", name: "search_products", arguments: '{"query":"pipe"}' }];
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "completed", output }), { status: 200 }));
    const provider = new AiProvider({ provider: "groq", apiKey: "test-groq-key-with-sufficient-length", model: "openai/gpt-oss-120b", speechModel: "whisper-large-v3-turbo" }, fetcher);
    const model = new ProviderAgentModel(provider);
    const tools = [{ type: "function", name: "search_products", description: "Search products", parameters: { type: "object" } }];
    const signal = new AbortController().signal;
    expect(await model.respond([{ role: "user", content: "pipe" }], tools, signal, { toolChoice: "required" }))
      .toEqual({ output, text: "" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/responses");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-groq-key-with-sufficient-length" });
    expect(options?.signal).toBe(signal);
    expect(JSON.parse(String(options?.body))).toMatchObject({
      model: "openai/gpt-oss-120b", tools, tool_choice: "required", parallel_tool_calls: false,
    });
    expect(JSON.parse(String(options?.body))).not.toHaveProperty("store");
  });
});
