import type { PricedEstimateLine } from "./estimate.types.js";
import type { QuotationDocument } from "./quotation.types.js";

export type InvoiceStatus = "DRAFT" | "POSTED" | "PARTIALLY_PAID" | "PAID" | "VOID";

export interface InvoiceDefinition {
  invoice_number: string;
  customer_id: number;
  issue_date: string;
  currency_code: string;
  notes?: string | null;
}

export interface InvoiceDraft {
  source_quotation_id: number;
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

export function buildInvoiceFromQuotation(
  quotation: QuotationDocument,
  definition: InvoiceDefinition,
  id = 0,
): InvoiceDocument {
  return {
    id,
    status: "DRAFT",
    source_quotation_id: quotation.id,
    definition,
    lines: quotation.lines,
    subtotal: quotation.subtotal,
    discount_total: quotation.discount_total,
    grand_total: quotation.grand_total,
    pass_through_rent: quotation.pass_through_rent,
  };
}
