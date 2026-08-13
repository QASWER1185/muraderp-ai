import type { PricedEstimateLine } from "./estimate.types.js";
import type { EstimateDocument } from "./estimate-document.types.js";

export type QuotationStatus = "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "CONVERTED" | "CANCELLED";

export interface QuotationDefinition {
  quotation_number: string;
  customer_id: number;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
}

export interface QuotationDraft {
  source_estimate_id: number;
  definition: QuotationDefinition;
  lines: PricedEstimateLine[];
}

export interface QuotationDocument {
  id: number;
  status: QuotationStatus;
  source_estimate_id: number;
  definition: QuotationDefinition;
  lines: PricedEstimateLine[];
  subtotal: number;
  discount_total: number;
  grand_total: number;
  pass_through_rent: number;
}

export function buildQuotationFromEstimate(
  estimate: EstimateDocument,
  definition: QuotationDefinition,
  id = 0,
): QuotationDocument {
  return {
    id,
    status: "DRAFT",
    source_estimate_id: estimate.id,
    definition,
    lines: estimate.lines,
    subtotal: estimate.totals.subtotal,
    discount_total: estimate.totals.discount_total,
    grand_total: estimate.totals.grand_total,
    pass_through_rent: estimate.totals.pass_through_rent,
  };
}
