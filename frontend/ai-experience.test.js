import { describe, expect, it } from "vitest";
import { buildAiReview, normalizeAiRequest } from "./ai-experience.js";

describe("Phase 22 AI experience", () => {
  it("normalizes text requests and preserves selected rate list context", () => {
    expect(normalizeAiRequest({ text: "25mm Popular pipe 50 pcs", rateListId: "popular", action: "estimate" })).toEqual({
      inputType: "text", text: "25mm Popular pipe 50 pcs", rateListId: "popular", action: "estimate"
    });
  });

  it("requires confirmation and never invents a rate", () => {
    const review = buildAiReview({ text: "50 Popular 25mm pipes", rateListId: "popular", action: "invoice" });
    expect(review.status).toBe("review_required");
    expect(review.confirmationRequired).toBe(true);
    expect(review.rateListId).toBe("popular");
    expect(review.note).toContain("authoritative pricing service");
  });

  it("rejects unsupported input types and actions", () => {
    expect(() => normalizeAiRequest({ inputType: "sql", text: "x" })).toThrow("Unsupported AI input type");
    expect(() => normalizeAiRequest({ action: "delete_database", text: "x" })).toThrow("Unsupported AI action");
  });

  it("rejects empty instructions", () => {
    expect(() => normalizeAiRequest({ text: "   " })).toThrow("AI instruction is required");
  });
});
