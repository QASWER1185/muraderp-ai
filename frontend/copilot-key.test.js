import { describe, expect, it } from "vitest";
import { clearCopilotApiKey, getCopilotApiKey, saveCopilotApiKey } from "./copilot-key.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe("Copilot browser key storage", () => {
  it("stores, reads, and removes a validated Gemini key", () => {
    const local = storage();
    const key = "AIzaSyExampleKeyForCopilot123456789";
    saveCopilotApiKey(key, local);
    expect(getCopilotApiKey(local)).toBe(key);
    clearCopilotApiKey(local);
    expect(getCopilotApiKey(local)).toBeNull();
  });

  it.each(["", "short", "x".repeat(513), `valid-${"x".repeat(20)}\nInjected: true`, "test-only-gemini-key with-space", "test-only-gemini-key\u0000suffix", "test-only-gemini-key\u200bsuffix"])(
    "rejects an invalid API key value",
    (value) => expect(() => saveCopilotApiKey(value, storage())).toThrow("valid Gemini API key"),
  );

  it.each(["test-only-gemini-key with-space", "test-only-gemini-key\u0000suffix", "test-only-gemini-key\u200bsuffix"])("does not send malformed legacy storage values to the backend", key => {
    const local = storage();
    local.setItem("muraderp.copilot.gemini-key.v1",key);
    expect(getCopilotApiKey(local)).toBeNull();
    expect(local.getItem("muraderp.copilot.gemini-key.v1")).toBe(key);
  });
  it("trims surrounding copy/paste padding before saving", () => {
    const local = storage();
    const key = "test-only-gemini-key-123456789";
    saveCopilotApiKey(`  ${key}\n`,local);
    expect(getCopilotApiKey(local)).toBe(key);
  });

  it("fails closed when browser storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(getCopilotApiKey(broken)).toBeNull();
    expect(() => clearCopilotApiKey(broken)).not.toThrow();
  });
});
