import { describe, expect, it } from "vitest";
import type { AiInputDraft } from "./ai-input.types.js";
import { normalizeDraftLines } from "./normalization.js";

function draftWithLines(lines: unknown[]): AiInputDraft {
  return {
    draftId: "draft-1",
    source: "text",
    intent: "estimate.create",
    organizationId: "org-1",
    userId: "user-1",
    status: "draft",
    requiresConfirmation: true,
    fields: {
      lines: { value: lines, confidence: 1, source: "text" },
    },
  };
}

describe("Phase 18 AI draft normalization", () => {
  it("normalizes text and preserves valid numeric values", () => {
    const result = normalizeDraftLines(
      draftWithLines([
        {
          productName: "  Bestway   Cement ",
          productId: "  10 ",
          quantity: 10,
          unit: " bag ",
          brandHint: " Bestway ",
          rateListHint: " retail ",
          unitRate: 1450,
        },
      ]),
    );

    expect(result).toEqual([
      {
        productName: "Bestway Cement",
        productId: "10",
        quantity: 10,
        unit: "bag",
        brandHint: "Bestway",
        rateListHint: "retail",
        unitRate: 1450,
      },
    ]);
  });

  it.each([
    ["quantity", Number.NaN],
    ["quantity", Infinity],
    ["quantity", 0],
    ["quantity", -1],
    ["unitRate", Number.NaN],
    ["unitRate", Infinity],
    ["unitRate", -1],
  ])("rejects unsafe %s values", (field, value) => {
    expect(() => normalizeDraftLines(draftWithLines([{ [field]: value }]))).toThrow();
  });

  it("rejects malformed line objects instead of silently normalizing them", () => {
    expect(() => normalizeDraftLines(draftWithLines(["not-a-line"]))).toThrow(
      "must be an object",
    );
  });

  it("unwraps extracted-field line values safely", () => {
    const result = normalizeDraftLines(
      draftWithLines([
        {
          productName: { value: "  Prime   Pipe " },
          quantity: { value: 5 },
          unitRate: { value: 3200 },
        },
      ]),
    );

    expect(result[0]).toEqual({
      productName: "Prime Pipe",
      quantity: 5,
      unitRate: 3200,
    });
  });
});
