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
    // OCR/AI may identify a brand, but a brand hint is not itself a financial
    // pricing decision. The caller must resolve it to a concrete user-owned
    // rate-list id before pricing can proceed.
    throw new Error("brand_hint requires an explicit resolved rate_list_id");
  }

  if (estimateDefaultRateListId !== null && estimateDefaultRateListId !== undefined) {
    const selection: EstimatePricingSelection = {
      mode: "RATE_LIST",
      rate_list_id: estimateDefaultRateListId,
      source: "INHERITED",
    };
    assertEstimatePricingSelection(selection);
    return selection;
  }

  throw new Error("no pricing selection available for estimate line");
}
