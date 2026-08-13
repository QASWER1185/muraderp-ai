import type { PricedEstimateLine } from "./estimate.types.js";

export type EstimateStatus = "DRAFT" | "READY" | "CONVERTED" | "CANCELLED";

export interface EstimateDefinition {
  customer_id: number;
  estimate_number: string;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
  /** Customer-facing delivery/vehicle rent collected for a third party. */
  pass_through_rent?: number;
  /** Driver/hauler/vehicle recipient of the pass-through rent. */
  pass_through_rent_payee?: string | null;
}

export interface EstimateDraft {
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
}

export interface EstimateTotals {
  /** Merchandise/services revenue only; excludes pass-through rent. */
  subtotal: number;
  discount_total: number;
  grand_total: number;
  /** Amount payable by customer including pass-through rent. */
  customer_payable_total: number;
  /** Explicitly excluded from business revenue/profit. */
  pass_through_rent: number;
}

/**
 * The estimate is a commercial document, not an accounting mutation.
 * Pass-through rent is displayed and collected from the customer but is not
 * treated as business revenue or expected profit. Later conversion into a
 * quotation/invoice must preserve this classification for accounting.
 */
export interface EstimateDocument {
  id: number;
  status: EstimateStatus;
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
  totals: EstimateTotals;
}
