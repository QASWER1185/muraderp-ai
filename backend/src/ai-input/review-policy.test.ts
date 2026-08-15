import { describe, expect, it } from "vitest";
import { evaluateDraftForReview } from "./review-policy.js";
import type { AiInputDraft } from "./ai-input.types.js";

describe("AI review policy", () => {
  it("keeps every AI draft behind human confirmation", () => {
    const draft: AiInputDraft = {
      draftId: "d1",
      source: "image",
      intent: "estimate.create",
      organizationId: "org-1",
      status: "validated",
      requiresConfirmation: true,
      fields: { lines: { value: [], confidence: 1, source: "image" } },
    };
    expect(evaluateDraftForReview(draft)).toEqual({ requiresHumanConfirmation: true, blockingReasons: [] });
  });

  it("blocks unvalidated drafts", () => {
    const draft: AiInputDraft = {
      draftId: "d2",
      source: "voice",
      intent: "estimate.create",
      organizationId: "org-1",
      status: "draft",
      requiresConfirmation: true,
      fields: {},
    };
    expect(evaluateDraftForReview(draft).blockingReasons).toContain("draft-not-yet-validated");
  });
});
