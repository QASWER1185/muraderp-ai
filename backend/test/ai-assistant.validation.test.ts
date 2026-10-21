import { describe, expect, it } from "vitest";
import { validateAssistantRequest } from "../src/ai-assistant/assistant.validation.js";

describe("validateAssistantRequest", () => {
  it("requires organization context", () => {
    expect(() => validateAssistantRequest({ userId: "u1", organizationId: "", message: "show sales" })).toThrow("organizationId is required");
  });

  it("rejects oversized assistant messages", () => {
    expect(() => validateAssistantRequest({ userId: "u1", organizationId: "o1", message: "x".repeat(4001) })).toThrow("message exceeds maximum length");
  });
});
