import { describe, expect, it } from "vitest";
import { DefaultInvoiceService, type InvoiceTransactionPort } from "./invoice.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";

const estimate: EstimateDocument = {
  id: 15,
  status: "READY",
  definition: { customer_id: 7, estimate_number: "EST-0015", issue_date: "2026-08-13", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" }],
  totals: { subtotal: 10000, discount_total: 500, grand_total: 9500, customer_payable_total: 10500, pass_through_rent: 1000 },
};

function transaction(): InvoiceTransactionPort {
  return {
    execute: async (invoice) => ({
      invoice: { ...invoice, id: 90 },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: true,
      cogs_recorded: true,
      profit_loss_recorded: true,
      pass_through_rent_recorded: true,
    }),
  };
}

describe("DefaultInvoiceService", () => {
  it("creates an invoice from an active estimate", async () => {
    const result = await new DefaultInvoiceService(transaction()).createFromEstimate(estimate, {
      invoice_number: "INV-0090",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    });

    expect(result.invoice.id).toBe(90);
    expect(result.invoice.source_estimate_id).toBe(15);
    expect(result.invoice.grand_total).toBe(9500);
    expect(result.invoice.pass_through_rent).toBe(1000);
    expect(result.inventory_decreased).toBe(true);
  });

  it("supports direct invoices without an estimate", async () => {
    const result = await new DefaultInvoiceService(transaction()).createDirect(
      { invoice_number: "INV-0091", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
      estimate.lines,
      10000,
      500,
      9500,
      1000,
    );

    expect(result.invoice.source_type).toBe("DIRECT");
    expect(result.invoice.source_estimate_id).toBeNull();
    expect(result.invoice.grand_total).toBe(9500);
  });

  it("rejects cancelled estimates", async () => {
    await expect(new DefaultInvoiceService(transaction()).createFromEstimate(
      { ...estimate, status: "CANCELLED" },
      { invoice_number: "INV-0092", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
    )).rejects.toThrow("only active estimates can be converted to invoice");
  });
});
