const TRANSITIONS = {
    draft: ["validated", "rejected"],
    validated: ["confirmed", "rejected"],
    confirmed: [],
    rejected: [],
};
export function transitionDraftStatus(draft, nextStatus) {
    if (!TRANSITIONS[draft.status].includes(nextStatus)) {
        throw new Error(`Invalid AI input draft transition: ${draft.status} -> ${nextStatus}`);
    }
    if (nextStatus === "confirmed" && draft.requiresConfirmation !== true) {
        throw new Error("AI input confirmation boundary is mandatory");
    }
    return { ...draft, status: nextStatus };
}
export function assertDraftBelongsToContext(draft, organizationId) {
    if (!organizationId || draft.organizationId !== organizationId) {
        throw new Error("AI input draft organization mismatch");
    }
}
//# sourceMappingURL=draft-lifecycle.js.map