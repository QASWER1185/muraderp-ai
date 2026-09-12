import type { AiDraft, AiDraftLine } from "../ai-input/contracts.js";
import { assertCopilotExecutionContext } from "./transaction-action.gateway.js";
import { createTransactionActionPlan } from "./transaction-action-planner.js";
import type { CopilotActionPlan, CopilotInputSource } from "./copilot.types.js";

export interface CopilotDraftContext {
  userId: string;
  branchId?: string;
  warehouseId?: number;
  rateListId?: number;
  documentNumber?: string;
  documentDate?: string;
  currencyCode?: string;
  reason?: string;
}

export interface CopilotDraftResult {
  plan: CopilotActionPlan;
  requiresConfirmation: true;
}

function positiveInteger(value: string | number | undefined, field: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function toPlannerLine(line: AiDraftLine, defaultRateListId?: number) {
  const productName = line.productName?.value?.trim();
  if (!productName) throw new Error("AI draft line is missing productName");
  const quantity = line.quantity?.value;
  if (typeof quantity !== "number") throw new Error(`AI draft line ${productName} is missing quantity`);

  const result: {
    productName: string;
    productId?: number;
    brandHint?: string;
    quantity: number;
    unit?: string;
    explicitUnitRate?: number;
    rateListId?: number;
    rateListSelectionSource?: "INHERITED" | "LINE_OVERRIDE";
    sourceItemId?: number;
  } = { productName, quantity };

  const productId = positiveInteger(line.productId?.value, "productId");
  if (productId !== undefined) result.productId = productId;
  const sourceItemId = positiveInteger(line.sourceItemId?.value, "sourceItemId");
  if (sourceItemId !== undefined) result.sourceItemId = sourceItemId;
  const lineRateListId = positiveInteger(line.rateListId?.value, "rateListId");
  if (lineRateListId !== undefined) result.rateListId = lineRateListId;

  const brandHint = line.productName?.rawText?.trim();
  if (brandHint && brandHint !== productName) result.brandHint = brandHint;
  if (line.unit?.value?.trim()) result.unit = line.unit.value.trim();
  if (line.unitRate?.value !== undefined) result.explicitUnitRate = line.unitRate.value;
  else if (lineRateListId === undefined && defaultRateListId !== undefined) {
    result.rateListId = defaultRateListId;
    result.rateListSelectionSource = "INHERITED";
  } else if (lineRateListId !== undefined) {
    result.rateListSelectionSource = "LINE_OVERRIDE";
  }
  return result;
}

export function createCopilotPlanFromDraft(
  draft: AiDraft,
  context: CopilotDraftContext,
): CopilotDraftResult {
  if (!draft.organizationId.trim()) throw new Error("organizationId is required");
  if (!context.userId.trim()) throw new Error("userId is required");
  if (draft.requiresHumanConfirmation !== true) {
    throw new Error("AI transaction drafts must require human confirmation");
  }

  const lines = draft.lines.map((line) => toPlannerLine(line, context.rateListId));
  const documentNumber = context.documentNumber ?? draft.documentNumber?.value;
  const input = {
    organizationId: draft.organizationId,
    ...(context.branchId !== undefined ? { branchId: context.branchId } : {}),
    userId: context.userId,
    source: draft.source as CopilotInputSource,
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

export function assertCopilotDraftExecution(
  plan: CopilotActionPlan,
  organizationId: string,
  userId: string,
  expectedIntent: CopilotActionPlan["target"],
  branchId?: string,
): void {
  assertCopilotExecutionContext(plan, organizationId, userId, branchId);
  if (plan.target !== expectedIntent) throw new Error("copilot action intent mismatch");
}
