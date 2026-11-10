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
    return { requiresHumanConfirmation: true, blockingReasons: reasons };
}
//# sourceMappingURL=review-policy-v2.js.map