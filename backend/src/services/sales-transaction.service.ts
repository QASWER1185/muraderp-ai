import type { InvoiceTransactionResult } from "../types/invoice.types.js";
import { assertSalesTransactionRequest, type SalesTransactionPort, type SalesTransactionRequest } from "../types/sales-transaction.types.js";

/**
 * User-facing Invoice creation ends at this boundary. The adapter behind the
 * port must perform the authoritative database transaction atomically.
 */
export class SalesTransactionService {
  constructor(private readonly transaction: SalesTransactionPort) {}

  async createInvoice(request: SalesTransactionRequest): Promise<InvoiceTransactionResult> {
    assertSalesTransactionRequest(request);
    return this.transaction.execute(request);
  }
}
