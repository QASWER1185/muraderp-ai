import { describe, expect, it } from "vitest";
import { evaluateDraftForReview } from "../src/ai-input/review-policy-v2.js";
import type { AiInputDraft } from "../src/ai-input/ai-input.types.js";

const draft = (status: AiInputDraft["status"]): AiInputDraft => ({
  draftId: "d1",
  source: "text",
  intent: "estimate.create",
  organizationId: "org-1",
  userId: "user-1",
  status,
  requiresConfirmation: true,
  fields: { lines: { value: [], confidence: 1, source: "text" } },
});

describe("Phase 18 review policy", () => {
  it("allows only validated drafts to proceed to human confirmation", () => {
    expect(evaluateDraftForReview(draft("validated")).blockingReasons).toEqual([]);
    expect(evaluateDraftForReview(draft("draft")).blockingReasons).toContain("draft-not-yet-validated");
    expect(evaluateDraftForReview(draft("rejected")).blockingReasons).toContain("draft-rejected");
  });
});
