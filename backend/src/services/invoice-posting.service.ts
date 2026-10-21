import type { InvoicePostingRequest, InvoicePostingResult } from "../types/invoice-posting.types.js";

export interface InvoicePostingTransaction {
  post(request: InvoicePostingRequest): Promise<InvoicePostingResult>;
}

/**
 * Posting is deliberately separated from invoice creation.
 * A future repository/transaction adapter will execute inventory, receivable,
 * accounting and pass-through-rent mutations atomically.
 */
export class ControlledInvoicePostingService {
  constructor(private readonly transaction: InvoicePostingTransaction) {}

  async post(request: InvoicePostingRequest): Promise<InvoicePostingResult> {
    if (!Number.isInteger(request.invoice_id) || request.invoice_id <= 0) {
      throw new Error("invoice_id must be a positive integer");
    }
    if (!Number.isInteger(request.customer_id) || request.customer_id <= 0) {
      throw new Error("customer_id must be a positive integer");
    }
    if (request.lines.length === 0) throw new Error("invoice must contain at least one line");
    if (request.grand_total < 0) throw new Error("grand_total cannot be negative");
    if (request.pass_through_rent < 0) throw new Error("pass_through_rent cannot be negative");

    return this.transaction.post(request);
  }
}
