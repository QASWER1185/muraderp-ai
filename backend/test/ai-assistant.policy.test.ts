import { describe, expect, it } from "vitest";
import { requiresExplicitConfirmation } from "../src/ai-assistant/assistant.policy.js";

describe("assistant mutation policy", () => {
  it("requires confirmation for drafts", () => {
    expect(requiresExplicitConfirmation("draft")).toBe(true);
  });

  it("does not require confirmation for read answers", () => {
    expect(requiresExplicitConfirmation("answer")).toBe(false);
  });
});
