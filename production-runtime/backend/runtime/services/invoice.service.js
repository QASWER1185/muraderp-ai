import { buildDirectInvoice, buildInvoiceFromEstimate, } from "../types/invoice.types.js";
export class DefaultInvoiceService {
    transaction;
    constructor(transaction) {
        this.transaction = transaction;
    }
    async createFromEstimate(estimate, definition) {
        if (estimate.status !== "DRAFT" && estimate.status !== "READY") {
            throw new Error("only active estimates can be converted to invoice");
        }
        if (estimate.id <= 0)
            throw new Error("estimate must have a persisted id");
        return this.transaction.execute(buildInvoiceFromEstimate(estimate, definition));
    }
    /** Quotation is only a presentation label for the same Estimate document. */
    async createFromQuotation(estimate, definition) {
        return this.createFromEstimate(estimate, definition);
    }
    async createDirect(definition, lines, subtotal, discount_total, grand_total, pass_through_rent) {
        if (lines.length === 0)
            throw new Error("invoice must contain at least one line");
        return this.transaction.execute(buildDirectInvoice(definition, lines, subtotal, discount_total, grand_total, pass_through_rent));
    }
    /**
     * Direct Invoice entry with the same three pricing modes supported by Estimate:
     * inherited/default rate list, per-line rate-list override/brand hint, or manual price.
     */
    async createDirectWithPricing(definition, lines, pricing, context, subtotal, discount_total, grand_total, pass_through_rent) {
        if (lines.length === 0)
            throw new Error("invoice must contain at least one line");
        const pricedLines = [];
        for (const line of lines) {
            pricedLines.push(await pricing.priceLine(line, context));
        }
        return this.transaction.execute(buildDirectInvoice(definition, pricedLines, subtotal, discount_total, grand_total, pass_through_rent));
    }
}
//# sourceMappingURL=invoice.service.js.map