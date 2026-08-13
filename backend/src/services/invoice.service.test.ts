import { describe, expect, it } from "vitest";
import { DefaultInvoiceService, type InvoiceRepository } from "./invoice.service.js";
import type { QuotationDocument } from "../types/quotation.types.js";

const quotation: QuotationDocument = {
  id: 50,
  status: "ACCEPTED",
  source_estimate_id: 15,
  definition: { quotation_number: "QUO-0015", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" }],
  subtotal: 10000,
  discount_total: 500,
  grand_total: 9500,
  pass_through_rent: 1000,
};

function repository(): InvoiceRepository {
  return { createInvoice: async (invoice) => ({ ...invoice, id: 90 }) };
}

describe("DefaultInvoiceService", () => {
  it("converts an accepted quotation while preserving commercial values", async () => {
    const result = await new DefaultInvoiceService(repository()).convertQuotation(quotation, {
      invoice_number: "INV-0090",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    });

    expect(result.id).toBe(90);
    expect(result.source_quotation_id).toBe(50);
    expect(result.grand_total).toBe(9500);
    expect(result.pass_through_rent).toBe(1000);
    expect(result.status).toBe("DRAFT");
  });

  it("rejects invoice conversion before quotation acceptance", async () => {
    const quotationDraft = { ...quotation, status: "SENT" as const };
    await expect(new DefaultInvoiceService(repository()).convertQuotation(quotationDraft, {
      invoice_number: "INV-0091",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    })).rejects.toThrow("only ACCEPTED quotations can be converted to invoice");
  });
});
