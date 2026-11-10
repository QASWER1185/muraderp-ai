export function evaluateDraftForReview(draft) {
    const reasons = [];
    if (draft.requiresConfirmation !== true)
        reasons.push("confirmation-boundary-required");
    if (draft.status === "rejected")
        reasons.push("draft-rejected");
    if (draft.status === "draft")
        reasons.push("draft-not-yet-validated");
    if (!draft.fields.lines)
        reasons.push("no-extracted-lines");
    const confidence = draft.fields.confidence?.value;
    if (typeof confidence === "number" && confidence < 0.8)
        reasons.push("low-document-confidence");
    return { requiresHumanConfirmation: true, blockingReasons: reasons };
}
//# sourceMappingURL=review-policy.js.map