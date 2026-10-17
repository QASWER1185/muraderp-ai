import type { PricedEstimateLine } from "./estimate.types.js";
import type { EstimateLayoutKey } from "./estimate-layout.types.js";

export type EstimateStatus = "DRAFT" | "READY" | "CONVERTED" | "CANCELLED";

export interface EstimateDefinition {
  organization_id: string;
  /** Branch in which the estimate is authored. Required by the authoritative atomic path. */
  branch_id?: string | null;
  customer_id: number;
  estimate_number: string;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
  pass_through_rent?: number;
  pass_through_rent_payee?: string | null;
  layout_key?: EstimateLayoutKey;
  /** Default sale rate list used when a line has no explicit override. */
  default_rate_list_id?: number | null;
}

export interface EstimateDraft {
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
}

export interface EstimateTotals {
  subtotal: number;
  discount_total: number;
  grand_total: number;
  pass_through_rent: number;
  customer_payable_total: number;
}

export interface EstimateDocument {
  id: number;
  status: EstimateStatus;
  definition: EstimateDefinition;
  lines: PricedEstimateLine[];
  totals: EstimateTotals;
}
