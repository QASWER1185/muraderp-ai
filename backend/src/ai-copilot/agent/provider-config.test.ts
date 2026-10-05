import { afterEach, describe, expect, it, vi } from "vitest";
const configuration = vi.hoisted(() => ({
  AI_PROVIDER: "openai", OPENAI_API_KEY: "test-openai-key", GROQ_API_KEY: "test-groq-key",
  AI_API_KEY: undefined as string | undefined, AI_MODEL: undefined as string | undefined,
  AI_BASE_URL: undefined as string | undefined,
}));
vi.mock("../../config/env.js", () => ({ env: configuration }));
import { ProviderAgentModel } from "./model.js";
afterEach(() => vi.unstubAllGlobals());

describe("unified Agent uses the existing provider configuration", () => {
  it.each([
    ["openai", "https://api.openai.com/v1/responses", "gpt-6-astra", "test-openai-key"],
    ["groq", "https://api.groq.com/openai/v1/responses", "openai/gpt-oss-120b", "test-groq-key"],
    ["compatible", "https://configured.example/v1/responses", "configured-model", "test-compatible-key"],
  ])("uses the %s endpoint, server credential and provider-specific model", async (provider, endpoint, model, key) => {
    configuration.AI_PROVIDER = provider;
    configuration.AI_API_KEY = provider === "compatible" ? key : undefined;
    configuration.AI_MODEL = provider === "compatible" ? model : undefined;
    configuration.AI_BASE_URL = provider === "compatible" ? "https://configured.example/v1" : undefined;
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ status: "completed", output: [] }) }));
    vi.stubGlobal("fetch", fetcher);
    await new ProviderAgentModel().respond([{ role: "user", content: "test" }], [], new AbortController().signal);
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe(endpoint);
    expect(JSON.parse(String(request[1].body)).model).toBe(model);
    expect(request[1].headers).toMatchObject({ Authorization: `Bearer ${key}` });
  });
});
