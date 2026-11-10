export function assertCopilotExecutionContext(plan, organizationId, userId, branchId) {
    if (plan.organizationId !== organizationId) {
        throw new Error("copilot action organization mismatch");
    }
    if (plan.userId !== userId) {
        throw new Error("copilot action user mismatch");
    }
    if (branchId !== undefined && plan.branchId !== branchId) {
        throw new Error("copilot action branch mismatch");
    }
    if (plan.requiresConfirmation !== true) {
        throw new Error("copilot transaction confirmation is mandatory");
    }
}
//# sourceMappingURL=transaction-action.gateway.js.map