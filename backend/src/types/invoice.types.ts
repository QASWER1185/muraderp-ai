import type { PricedEstimateLine } from "./estimate.types.js";
import type { EstimateDocument } from "./estimate-document.types.js";

/** Invoice is the authoritative sales transaction. There is no user-facing post step. */
export type InvoiceStatus = "POSTED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface InvoiceDefinition {
  invoice_number: string;
  customer_id: number;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
}

export type InvoiceSourceType = "DIRECT" | "FROM_ESTIMATE";

export interface InvoiceDraft {
  source_estimate_id: number | null;
  source_type: InvoiceSourceType;
  definition: InvoiceDefinition;
  lines: PricedEstimateLine[];
  subtotal: number;
  discount_total: number;
  grand_total: number;
  pass_through_rent: number;
}

export interface InvoiceDocument extends InvoiceDraft {
  id: number;
  status: InvoiceStatus;
}

export interface InvoiceTransactionResult {
  invoice: InvoiceDocument;
  inventory_decreased: boolean;
  customer_receivable_updated: boolean;
  revenue_recorded: boolean;
  cogs_recorded: boolean;
  profit_loss_recorded: boolean;
  pass_through_rent_recorded: boolean;
}

export function buildInvoiceFromEstimate(estimate: EstimateDocument, definition: InvoiceDefinition, id = 0): InvoiceDocument {
  return {
    id,
    status: "POSTED",
    source_estimate_id: estimate.id,
    source_type: "FROM_ESTIMATE",
    definition,
    lines: estimate.lines,
    subtotal: estimate.totals.subtotal,
    discount_total: estimate.totals.discount_total,
    grand_total: estimate.totals.grand_total,
    pass_through_rent: estimate.totals.pass_through_rent,
  };
}

export function buildDirectInvoice(
  definition: InvoiceDefinition,
  lines: PricedEstimateLine[],
  subtotal: number,
  discount_total: number,
  grand_total: number,
  pass_through_rent: number,
  id = 0,
): InvoiceDocument {
  return {
    id,
    status: "POSTED",
    source_estimate_id: null,
    source_type: "DIRECT",
    definition,
    lines,
    subtotal,
    discount_total,
    grand_total,
    pass_through_rent,
  };
}
