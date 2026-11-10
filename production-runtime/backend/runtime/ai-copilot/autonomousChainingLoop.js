/** One preparation cycle. All writes remain behind the combined approval. */
export class AutonomousChainingLoop {
    tools;
    constructor(tools) {
        this.tools = tools;
    }
    async prepareEstimate(choices, scope, state, userMessage) {
        if (typeof choices.brand === "string")
            state.brandHint = choices.brand;
        else
            delete state.brandHint;
        const result = await this.tools.execute("erp_create_estimate", choices, scope, state, userMessage);
        const review = result.review;
        if (typeof choices.customerName === "string")
            state.estimateCustomerChoice = { name: choices.customerName, ...(typeof choices.customerAddress === "string" ? { address: choices.customerAddress } : {}) };
        const answer = review.preview.summary;
        const requiresConfirmation = review.requiresConfirmation !== false && !review.preview.incomplete;
        if (requiresConfirmation)
            state.pendingAction = { draftId: review.draftId, idempotencyKey: review.idempotencyKey, summary: answer.slice(0, 1000), expires: Math.min(state.expires, Date.now() + 10 * 60_000) };
        else
            delete state.pendingAction;
        state.workingActionId = review.draftId;
        state.workingActionTool = "erp_create_estimate";
        if (review.preview.mode === 'DEMAND_SLIP_ESTIMATE')
            state.workingActionMode = 'DEMAND_SLIP_ESTIMATE';
        return { answer, review, requiresConfirmation, stages: ["پرچی کی تمام لائنیں", "گاہک کی شناخت یا مشترکہ نیا گاہک پری ویو", "فعال برانڈ ریٹ لسٹ", "ساتھ لگنے والے سامان کی جانچ", "خرید لاگت اور رعایت کی پڑتال", "اردو تخمینہ اور واٹس ایپ کارڈ"] };
    }
}
//# sourceMappingURL=autonomousChainingLoop.js.map