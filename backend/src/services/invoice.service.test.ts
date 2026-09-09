import { describe, expect, it } from "vitest";
import { DefaultInvoiceService, type InvoiceTransactionPort } from "./invoice.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { EstimateLineDraft, EstimatePricingService, PricedEstimateLine } from "../types/estimate.types.js";

const estimate: EstimateDocument = {
  id: 15,
  status: "READY",
  definition: { organization_id: "11111111-1111-4111-8111-111111111111", customer_id: 7, estimate_number: "EST-0015", issue_date: "2026-08-13", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" }],
  totals: { subtotal: 10000, discount_total: 500, grand_total: 9500, customer_payable_total: 10500, pass_through_rent: 1000 },
};

const directLine: EstimateLineDraft = {
  line_number: 1,
  product_id: 25,
  quantity: 10,
  unit: "bag",
  brand_hint: "POPULAR",
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

function pricing(): EstimatePricingService {
  return {
    priceLine: async (line, context): Promise<PricedEstimateLine> => ({
      ...line,
      unit_price: context.rate_list_id === 10 ? 1250 : 50,
      pricing_source: context.rate_list_id === 10 ? "RESOLVED_RATE" : "MANUAL_OVERRIDE",
    }),
  } as EstimatePricingService;
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

  it("supports direct invoices through the shared rate-list pricing engine", async () => {
    const result = await new DefaultInvoiceService(transaction()).createDirectWithPricing(
      { invoice_number: "INV-0093", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
      [directLine],
      pricing(),
      { organization_id: "11111111-1111-4111-8111-111111111111", price_type: "SALE", as_of: "2026-08-13", rate_list_id: 10 },
      12500,
      0,
      12500,
      0,
    );

    expect(result.invoice.source_type).toBe("DIRECT");
    expect(result.invoice.lines[0]?.unit_price).toBe(1250);
    expect(result.invoice.lines[0]?.pricing_source).toBe("RESOLVED_RATE");
  });

  it("allows direct invoice pricing to use a manual-price context", async () => {
    const result = await new DefaultInvoiceService(transaction()).createDirectWithPricing(
      { invoice_number: "INV-0094", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
      [directLine],
      pricing(),
      { organization_id: "11111111-1111-4111-8111-111111111111", price_type: "SALE", as_of: "2026-08-13", rate_list_id: null },
      500,
      0,
      500,
      0,
    );

    expect(result.invoice.lines[0]?.unit_price).toBe(50);
    expect(result.invoice.lines[0]?.pricing_source).toBe("MANUAL_OVERRIDE");
  });

  it("rejects cancelled estimates", async () => {
    await expect(new DefaultInvoiceService(transaction()).createFromEstimate(
      { ...estimate, status: "CANCELLED" },
      { invoice_number: "INV-0092", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
    )).rejects.toThrow("only active estimates can be converted to invoice");
  });
});
