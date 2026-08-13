import type { PricedEstimateLine } from "./estimate.types.js";

export type EstimateStatus = "DRAFT" | "READY" | "CONVERTED" | "CANCELLED";

export interface EstimateDefinition {
  customer_id: number;
  estimate_number: string;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
}

export interface EstimateDraft {
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
}

export interface EstimateTotals {
  subtotal: number;
  discount_total: number;
  grand_total: number;
}

/**
 * The estimate is a commercial document, not an accounting mutation.
 * Later conversion into quotation/invoice must create a new controlled
 * document and retain the source estimate for auditability.
 */
export interface EstimateDocument {
  id: number;
  status: EstimateStatus;
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
  totals: EstimateTotals;
}
