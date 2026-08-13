import { assertEstimatePricingSelection, type EstimatePricingSelection } from "../types/estimate-pricing-selection.types.js";

export interface EstimateLinePricingInstruction {
  selection?: EstimatePricingSelection;
  brand_hint?: string | null;
}

export function resolveEstimatePricingInstruction(
  estimateDefaultRateListId: number | null | undefined,
  instruction: EstimateLinePricingInstruction,
): EstimatePricingSelection {
  if (instruction.selection) {
    assertEstimatePricingSelection(instruction.selection);
    return instruction.selection;
  }

  if (instruction.brand_hint?.trim()) {
    return {
      mode: "RATE_LIST",
      rate_list_id: null,
      source: "AI_SUGGESTED",
    };
  }

  if (estimateDefaultRateListId !== null && estimateDefaultRateListId !== undefined) {
    return {
      mode: "RATE_LIST",
      rate_list_id: estimateDefaultRateListId,
      source: "INHERITED",
    };
  }

  throw new Error("no pricing selection available for estimate line");
}
