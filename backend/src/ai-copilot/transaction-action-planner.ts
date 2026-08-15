import type { EstimatePricingSelection } from "../types/estimate-pricing-selection.types.js";
import { assertEstimatePricingSelection } from "../types/estimate-pricing-selection.types.js";
import type { CopilotActionPlan, CopilotLineCandidate, CopilotPlannerInput } from "./copilot.types.js";

function resolvePricing(line: CopilotPlannerInput["lines"][number]): {
  rateSource: CopilotLineCandidate["rateSource"];
  pricingSelection?: EstimatePricingSelection;
} {
  if (line.explicitUnitRate !== undefined) {
    if (!Number.isFinite(line.explicitUnitRate) || line.explicitUnitRate < 0) {
      throw new Error("explicitUnitRate must be zero or greater");
    }
    const selection: EstimatePricingSelection = {
      mode: "MANUAL",
      manual_unit_price: line.explicitUnitRate,
      source: "MANUAL",
    };
    assertEstimatePricingSelection(selection);
    return { rateSource: "EXPLICIT_USER_RATE", pricingSelection: selection };
  }

  if (line.rateListId !== undefined) {
    if (!Number.isInteger(line.rateListId) || line.rateListId <= 0) {
      throw new Error("rateListId must be a positive integer");
    }
    const selection: EstimatePricingSelection = {
      mode: "RATE_LIST",
      rate_list_id: line.rateListId,
      source: line.brandHint?.trim() ? "AI_SUGGESTED" : "INHERITED",
    };
    assertEstimatePricingSelection(selection);
    return { rateSource: "SELECTED_RATE_LIST", pricingSelection: selection };
  }

  if (line.brandHint?.trim()) return { rateSource: "UNRESOLVED_BRAND_HINT" };
  return { rateSource: "UNRESOLVED" };
}

export function createTransactionActionPlan(input: CopilotPlannerInput): CopilotActionPlan {
  if (!input.organizationId.trim()) throw new Error("organizationId is required");
  if (!input.userId.trim()) throw new Error("userId is required");
  if (input.lines.length === 0) throw new Error("at least one transaction line is required");

  const lines = input.lines.map((line): CopilotLineCandidate => {
    if (!line.productName.trim()) throw new Error("productName is required");
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new Error("quantity must be greater than zero");
    }
    if (line.productId !== undefined && (!Number.isInteger(line.productId) || line.productId <= 0)) {
      throw new Error("productId must be a positive integer");
    }
    if (line.sourceItemId !== undefined && (!Number.isInteger(line.sourceItemId) || line.sourceItemId <= 0)) {
      throw new Error("sourceItemId must be a positive integer");
    }

    const pricing = resolvePricing(line);
    const candidate: CopilotLineCandidate = {
      productName: line.productName.trim(),
      quantity: line.quantity,
      rateSource: pricing.rateSource,
    };
    if (line.productId !== undefined) candidate.productId = line.productId;
    if (line.brandHint?.trim()) candidate.brandHint = line.brandHint.trim();
    if (line.unit?.trim()) candidate.unit = line.unit.trim();
    if (line.explicitUnitRate !== undefined) candidate.explicitUnitRate = line.explicitUnitRate;
    if (line.sourceItemId !== undefined) candidate.sourceItemId = line.sourceItemId;
    if (pricing.pricingSelection !== undefined) candidate.pricingSelection = pricing.pricingSelection;
    return candidate;
  });

  const plan: CopilotActionPlan = {
    organizationId: input.organizationId,
    userId: input.userId,
    source: input.source,
    target: input.target,
    lines,
    requiresConfirmation: true,
  };
  if (input.customerId?.trim()) plan.customerId = input.customerId.trim();
  if (input.vendorId?.trim()) plan.vendorId = input.vendorId.trim();
  if (input.warehouseId !== undefined) plan.warehouseId = input.warehouseId;
  if (input.documentNumber?.trim()) plan.documentNumber = input.documentNumber.trim();
  if (input.documentDate?.trim()) plan.documentDate = input.documentDate.trim();
  if (input.currencyCode?.trim()) plan.currencyCode = input.currencyCode.trim();
  if (input.reason?.trim()) plan.reason = input.reason.trim();
  return plan;
}
