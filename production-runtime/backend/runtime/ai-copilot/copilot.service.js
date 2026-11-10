import { assertCopilotExecutionContext } from "./transaction-action.gateway.js";
import { createTransactionActionPlan } from "./transaction-action-planner.js";
function positiveInteger(value, field) {
    if (value === undefined || value === "")
        return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`${field} must be a positive integer`);
    return parsed;
}
function toPlannerLine(line, defaultRateListId) {
    const productName = line.productName?.value?.trim();
    if (!productName)
        throw new Error("AI draft line is missing productName");
    const quantity = line.quantity?.value;
    if (typeof quantity !== "number")
        throw new Error(`AI draft line ${productName} is missing quantity`);
    const result = { productName, quantity };
    const productId = positiveInteger(line.productId?.value, "productId");
    if (productId !== undefined)
        result.productId = productId;
    const sourceItemId = positiveInteger(line.sourceItemId?.value, "sourceItemId");
    if (sourceItemId !== undefined)
        result.sourceItemId = sourceItemId;
    const lineRateListId = positiveInteger(line.rateListId?.value, "rateListId");
    if (lineRateListId !== undefined)
        result.rateListId = lineRateListId;
    const brandHint = line.productName?.rawText?.trim();
    if (brandHint && brandHint !== productName)
        result.brandHint = brandHint;
    if (line.unit?.value?.trim())
        result.unit = line.unit.value.trim();
    if (line.unitRate?.value !== undefined)
        result.explicitUnitRate = line.unitRate.value;
    else if (lineRateListId === undefined && defaultRateListId !== undefined) {
        result.rateListId = defaultRateListId;
        result.rateListSelectionSource = "INHERITED";
    }
    else if (lineRateListId !== undefined) {
        result.rateListSelectionSource = "LINE_OVERRIDE";
    }
    return result;
}
export function createCopilotPlanFromDraft(draft, context) {
    if (!draft.organizationId.trim())
        throw new Error("organizationId is required");
    if (!context.userId.trim())
        throw new Error("userId is required");
    if (draft.requiresHumanConfirmation !== true) {
        throw new Error("AI transaction drafts must require human confirmation");
    }
    const lines = draft.lines.map((line) => toPlannerLine(line, context.rateListId));
    const documentNumber = context.documentNumber ?? draft.documentNumber?.value;
    const input = {
        organizationId: draft.organizationId,
        ...(context.branchId !== undefined ? { branchId: context.branchId } : {}),
        userId: context.userId,
        source: draft.source,
        target: draft.intent,
        lines,
        ...(draft.customerId?.value !== undefined ? { customerId: String(draft.customerId.value) } : {}),
        ...(draft.vendorId?.value !== undefined ? { vendorId: String(draft.vendorId.value) } : {}),
        ...(context.warehouseId !== undefined ? { warehouseId: context.warehouseId } : {}),
        ...(documentNumber !== undefined ? { documentNumber: String(documentNumber) } : {}),
        ...(context.documentDate !== undefined ? { documentDate: context.documentDate } : {}),
        ...(context.currencyCode !== undefined ? { currencyCode: context.currencyCode } : {}),
        ...(context.reason !== undefined ? { reason: context.reason } : {}),
    };
    const plan = createTransactionActionPlan(input);
    return { plan, requiresConfirmation: true };
}
export function assertCopilotDraftExecution(plan, organizationId, userId, expectedIntent, branchId) {
    assertCopilotExecutionContext(plan, organizationId, userId, branchId);
    if (plan.target !== expectedIntent)
        throw new Error("copilot action intent mismatch");
}
//# sourceMappingURL=copilot.service.js.map