import type { QuotationDocument } from "../types/quotation.types.js";
import { buildInvoiceFromQuotation, type InvoiceDefinition, type InvoiceDocument } from "../types/invoice.types.js";

export interface InvoiceRepository {
  createInvoice(invoice: InvoiceDocument): Promise<InvoiceDocument>;
}

export class DefaultInvoiceService {
  constructor(private readonly repository: InvoiceRepository) {}

  async convertQuotation(
    quotation: QuotationDocument,
    definition: InvoiceDefinition,
  ): Promise<InvoiceDocument> {
    if (quotation.status !== "ACCEPTED") {
      throw new Error("only ACCEPTED quotations can be converted to invoice");
    }
    if (quotation.id <= 0) throw new Error("quotation must have a persisted id");
    if (!definition.invoice_number.trim()) throw new Error("invoice_number is required");
    if (!Number.isInteger(definition.customer_id) || definition.customer_id <= 0) {
      throw new Error("customer_id must be a positive integer");
    }

    return this.repository.createInvoice(buildInvoiceFromQuotation(quotation, definition));
  }
}
