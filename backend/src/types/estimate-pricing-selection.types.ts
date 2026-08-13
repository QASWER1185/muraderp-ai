export type EstimateRateSelectionSource =
  | "INHERITED"
  | "LINE_OVERRIDE"
  | "AI_SUGGESTED"
  | "MANUAL";

export type EstimatePriceMode = "RATE_LIST" | "MANUAL";

export interface EstimatePricingSelection {
  mode: EstimatePriceMode;
  rate_list_id?: number | null;
  source: EstimateRateSelectionSource;
  manual_unit_price?: number | null;
}

export function assertEstimatePricingSelection(selection: EstimatePricingSelection): void {
  if (selection.mode === "RATE_LIST") {
    const rateListId = selection.rate_list_id;
    if (!Number.isInteger(rateListId) || rateListId <= 0) {
      throw new Error("rate_list_id is required when price mode is RATE_LIST");
    }
    if (selection.manual_unit_price !== undefined && selection.manual_unit_price !== null) {
      throw new Error("manual_unit_price cannot be supplied in RATE_LIST mode");
    }
    return;
  }

  const manualUnitPrice = selection.manual_unit_price;
  if (manualUnitPrice === undefined || manualUnitPrice === null) {
    throw new Error("manual_unit_price is required when price mode is MANUAL");
  }
  if (!Number.isFinite(manualUnitPrice) || manualUnitPrice < 0) {
    throw new Error("manual_unit_price must be zero or greater");
  }
}
