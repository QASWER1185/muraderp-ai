import type { AiInputDraft, AiInputStatus } from "./ai-input.types.js";

const TRANSITIONS: Record<AiInputStatus, readonly AiInputStatus[]> = {
  draft: ["validated", "rejected"],
  validated: ["confirmed", "rejected"],
  confirmed: [],
  rejected: [],
};

export function transitionDraftStatus(
  draft: AiInputDraft,
  nextStatus: AiInputStatus,
): AiInputDraft {
  if (!TRANSITIONS[draft.status].includes(nextStatus)) {
    throw new Error(`Invalid AI input draft transition: ${draft.status} -> ${nextStatus}`);
  }

  if (nextStatus === "confirmed" && draft.requiresConfirmation !== true) {
    throw new Error("AI input confirmation boundary is mandatory");
  }

  return { ...draft, status: nextStatus };
}

export function assertDraftBelongsToContext(
  draft: AiInputDraft,
  organizationId: string,
): void {
  if (!organizationId || draft.organizationId !== organizationId) {
    throw new Error("AI input draft organization mismatch");
  }
}
