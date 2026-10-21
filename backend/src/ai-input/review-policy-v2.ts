import type { AiInputDraft } from "./ai-input.types.js";

export interface AiReviewDecision {
  requiresHumanConfirmation: true;
  blockingReasons: string[];
}

export function evaluateDraftForReview(draft: AiInputDraft): AiReviewDecision {
  const reasons: string[] = [];
  if (draft.requiresConfirmation !== true) reasons.push("confirmation-boundary-required");
  if (draft.status === "rejected") reasons.push("draft-rejected");
  if (draft.status === "draft") reasons.push("draft-not-yet-validated");
  if (!draft.fields.lines) reasons.push("no-extracted-lines");
  return { requiresHumanConfirmation: true, blockingReasons: reasons };
}
