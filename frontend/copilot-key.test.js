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

  it.each(["", "short", "x".repeat(513), `valid-${"x".repeat(20)}\nInjected: true`])(
    "rejects an invalid API key value",
    (value) => expect(() => saveCopilotApiKey(value, storage())).toThrow("valid Gemini API key"),
  );

  it("fails closed when browser storage is unavailable", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(getCopilotApiKey(broken)).toBeNull();
    expect(() => clearCopilotApiKey(broken)).not.toThrow();
  });
});
