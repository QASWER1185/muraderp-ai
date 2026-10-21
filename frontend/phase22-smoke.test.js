import { describe, expect, it } from "vitest";
import { buildAiReview } from "./ai-experience.js";

describe("Phase 22 acceptance examples", () => {
  it("prepares estimate from item/quantity text without inventing a rate", () => {
    const review = buildAiReview({
      action: "estimate",
      text: "25mm Popular pipe 50 pcs",
      rateListId: "popular"
    });
    expect(review.confirmationRequired).toBe(true);
    expect(review.instruction).toContain("50 pcs");
    expect(review.note).toMatch(/authoritative pricing service/i);
  });

  it("keeps explicit user rate as input text for authoritative validation", () => {
    const review = buildAiReview({
      action: "invoice",
      text: "25mm Popular pipe 50 pcs rate 120",
      rateListId: "popular"
    });
    expect(review.instruction).toContain("rate 120");
    expect(review.confirmationRequired).toBe(true);
  });
});
