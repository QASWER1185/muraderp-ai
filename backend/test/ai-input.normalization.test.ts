import { describe, expect, it } from "vitest";
import { normalizeDraftLines } from "../src/ai-input/normalization.js";
import type { AiInputDraft } from "../src/ai-input/ai-input.types.js";

describe("AI input normalization", () => {
  it("normalizes whitespace while preserving extracted values", () => {
    const draft: AiInputDraft = {
      draftId: "d1",
      source: "text",
      intent: "estimate.create",
      organizationId: "org-1",
      userId: "user-1",
      status: "validated",
      requiresConfirmation: true,
      fields: {
        lines: {
          value: [{
            productName: { value: "  Popular   Pipe 25mm ", confidence: 0.99, source: "text" },
            quantity: { value: 50, confidence: 0.99, source: "text" },
            unit: { value: " pcs ", confidence: 0.98, source: "text" },
            brandHint: { value: " Popular ", confidence: 0.98, source: "text" },
          }],
          confidence: 0.99,
          source: "text",
        },
      },
    };

    expect(normalizeDraftLines(draft)).toEqual([{
      productName: "Popular Pipe 25mm",
      quantity: 50,
      unit: "pcs",
      brandHint: "Popular",
    }]);
  });

  it("returns no lines when the extraction has no line array", () => {
    const draft: AiInputDraft = {
      draftId: "d2",
      source: "voice",
      intent: "estimate.create",
      organizationId: "org-1",
      userId: "user-1",
      status: "draft",
      requiresConfirmation: true,
      fields: {},
    };

    expect(normalizeDraftLines(draft)).toEqual([]);
  });
});
