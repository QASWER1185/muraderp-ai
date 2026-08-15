import { describe, expect, it } from "vitest";
import { createAssistantService } from "../src/ai-assistant/assistant.factory.js";

describe("assistant factory", () => {
  it("exports the assistant factory", () => {
    expect(createAssistantService).toBeTypeOf("function");
  });
});
