import type { AiDraft, AiDraftLine, AiInputIntent } from "../ai-input/contracts.js";
import { assertCopilotExecutionContext } from "./transaction-action.gateway.js";
import { createTransactionActionPlan } from "./transaction-action-planner.js";
import type { CopilotActionPlan, CopilotInputSource } from "./copilot.types.js";

export interface CopilotDraftContext {
  userId: string;
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
    sourceItemId?: number;
  } = { productName, quantity };

  if (line.productId?.value !== undefined) result.productId = line.productId.value;
  const brandHint = line.productName?.rawText?.trim();
  if (brandHint && brandHint !== productName) result.brandHint = brandHint;
  if (line.unit?.value?.trim()) result.unit = line.unit.value.trim();
  if (line.unitRate?.value !== undefined) result.explicitUnitRate = line.unitRate.value;
  else if (defaultRateListId !== undefined) result.rateListId = defaultRateListId;

  const sourceItemId = (line as AiDraftLine & { sourceItemId?: { value?: number } }).sourceItemId?.value;
  if (sourceItemId !== undefined) result.sourceItemId = sourceItemId;
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
  const plan = createTransactionActionPlan({
    organizationId: draft.organizationId,
    userId: context.userId,
    source: draft.source as CopilotInputSource,
    target: draft.intent,
    ...(draft.customerId?.value ? { customerId: draft.customerId.value } : {}),
    ...(draft.vendorId?.value ? { vendorId: draft.vendorId.value } : {}),
    ...(context.warehouseId !== undefined ? { warehouseId: context.warehouseId } : {}),
    ...(context.documentNumber ?? draft.documentNumber?.value ? { documentNumber: context.documentNumber ?? draft.documentNumber?.value } : {}),
    ...(context.documentDate ? { documentDate: context.documentDate } : {}),
    ...(context.currencyCode ? { currencyCode: context.currencyCode } : {}),
    ...(context.reason ? { reason: context.reason } : {}),
    lines,
  });

  return { plan, requiresConfirmation: true };
}

export function assertCopilotDraftExecution(
  plan: CopilotActionPlan,
  organizationId: string,
  userId: string,
  expectedIntent: AiInputIntent,
): void {
  assertCopilotExecutionContext(plan, organizationId, userId);
  if (plan.target !== expectedIntent) throw new Error("copilot action intent mismatch");
}
