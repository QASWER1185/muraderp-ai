import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { QuotationDocument } from "../types/quotation.types.js";
import {
  buildDirectInvoice,
  buildInvoiceFromEstimate,
  buildInvoiceFromQuotation,
  type InvoiceDefinition,
  type InvoiceDocument,
  type InvoiceTransactionResult,
} from "../types/invoice.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

/**
 * The application treats Invoice creation as the user-facing sales action.
 * The transaction port performs all authoritative business effects atomically.
 */
export interface InvoiceTransactionPort {
  execute(invoice: InvoiceDocument): Promise<InvoiceTransactionResult>;
}

export class DefaultInvoiceService {
  constructor(private readonly transaction: InvoiceTransactionPort) {}

  async createFromEstimate(
    estimate: EstimateDocument,
    definition: InvoiceDefinition,
  ): Promise<InvoiceTransactionResult> {
    if (estimate.status !== "DRAFT" && estimate.status !== "READY") {
      throw new Error("only active estimates can be converted to invoice");
    }
    if (estimate.id <= 0) throw new Error("estimate must have a persisted id");
    return this.transaction.execute(buildInvoiceFromEstimate(estimate, definition));
  }

  async createFromQuotation(
    quotation: QuotationDocument,
    definition: InvoiceDefinition,
  ): Promise<InvoiceTransactionResult> {
    if (quotation.status !== "ACCEPTED") {
      throw new Error("only ACCEPTED quotations can be converted to invoice");
    }
    if (quotation.id <= 0) throw new Error("quotation must have a persisted id");
    return this.transaction.execute(buildInvoiceFromQuotation(quotation, definition));
  }

  async createDirect(
    definition: InvoiceDefinition,
    lines: PricedEstimateLine[],
    subtotal: number,
    discount_total: number,
    grand_total: number,
    pass_through_rent: number,
  ): Promise<InvoiceTransactionResult> {
    if (lines.length === 0) throw new Error("invoice must contain at least one line");
    return this.transaction.execute(
      buildDirectInvoice(definition, lines, subtotal, discount_total, grand_total, pass_through_rent),
    );
  }
}
