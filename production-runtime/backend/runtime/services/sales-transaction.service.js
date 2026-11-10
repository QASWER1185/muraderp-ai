import { assertSalesTransactionRequest } from "../types/sales-transaction.types.js";
/**
 * User-facing Invoice creation ends at this boundary. The adapter behind the
 * port must perform the authoritative database transaction atomically.
 */
export class SalesTransactionService {
    transaction;
    constructor(transaction) {
        this.transaction = transaction;
    }
    async createInvoice(request) {
        assertSalesTransactionRequest(request);
        return this.transaction.execute(request);
    }
}
//# sourceMappingURL=sales-transaction.service.js.map