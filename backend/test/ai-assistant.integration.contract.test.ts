import { describe, expect, it } from "vitest";
import type { AssistantActionGateway } from "../src/ai-assistant/assistant.types.js";

describe("assistant integration contract", () => {
  it("requires a gateway that separates reads from draft mutations", () => {
    const gateway: AssistantActionGateway = {
      executeRead: async () => "ok",
      createDraft: async () => "draft",
    };

    expect(gateway.executeRead).toBeTypeOf("function");
    expect(gateway.createDraft).toBeTypeOf("function");
  });
});
