import { describe, expect, it, vi } from "vitest";
import { DefaultInvoiceService, type InvoiceTransactionPort } from "./invoice.service.js";
import type { EstimateLineDraft, EstimatePricingService, PricedEstimateLine } from "../types/estimate.types.js";
import type { InvoiceTransactionResult } from "../types/invoice.types.js";

const transaction: InvoiceTransactionPort = {
  execute: async (invoice): Promise<InvoiceTransactionResult> => ({
    invoice: { ...invoice, id: 901, status: "POSTED" },
    inventory_decreased: true,
    customer_receivable_updated: true,
    revenue_recorded: true,
    cogs_recorded: true,
    profit_loss_recorded: true,
    pass_through_rent_recorded: invoice.pass_through_rent > 0,
  }),
};

function pricing(): EstimatePricingService {
  return {
    priceLine: vi.fn(async (line, context): Promise<PricedEstimateLine> => ({
      ...line,
      unit_price: line.rate_list_id === 44 ? 1400 : context.rate_list_id === 22 ? 1500 : 1600,
      pricing_source: "RESOLVED_RATE",
      rate_list_id: line.rate_list_id ?? context.rate_list_id ?? null,
    })),
  };
}

const baseDefinition = {
  invoice_number: "INV-PRICING-001",
  customer_id: 7,
  issue_date: "2026-08-14",
  currency_code: "PKR",
};

const mixedLines: EstimateLineDraft[] = [
  { line_number: 1, product_id: 25, quantity: 10, unit: "piece", rate_list_id: 44, rate_list_selection_source: "LINE_OVERRIDE", brand_hint: "Dura" },
  { line_number: 2, product_id: 26, quantity: 5, unit: "piece", brand_hint: "Popular" },
];

describe("Invoice pricing parity", () => {
  it("passes per-line rate-list overrides through the shared pricing service", async () => {
    const service = new DefaultInvoiceService(transaction);
    const pricingService = pricing();

    const result = await service.createDirectWithPricing(
      baseDefinition,
      mixedLines,
      pricingService,
      { price_type: "SALE", as_of: "2026-08-14T10:00:00Z", rate_list_id: 22 },
      21500,
      0,
      21500,
      0,
    );

    expect(result.invoice.id).toBe(901);
    expect(result.invoice.lines[0]?.unit_price).toBe(1400);
    expect(result.invoice.lines[1]?.unit_price).toBe(1500);

    expect(pricingService.priceLine).toHaveBeenNthCalledWith(
      1,
      mixedLines[0],
      expect.objectContaining({ rate_list_id: 22 }),
    );
    expect(pricingService.priceLine).toHaveBeenNthCalledWith(
      2,
      mixedLines[1],
      expect.objectContaining({ rate_list_id: 22 }),
    );
  });

  it("keeps manual unit prices authoritative over rate-list resolution", async () => {
    const service = new DefaultInvoiceService(transaction);
    const pricingService: EstimatePricingService = {
      priceLine: vi.fn(async (line) => ({
        ...line,
        unit_price: line.unit_price ?? 0,
        pricing_source: line.unit_price !== undefined ? "MANUAL_OVERRIDE" : "RESOLVED_RATE",
      })),
    };

    const line: EstimateLineDraft = {
      line_number: 1,
      product_id: 25,
      quantity: 2,
      unit: "piece",
      unit_price: 175,
      rate_list_id: 44,
      rate_list_selection_source: "LINE_OVERRIDE",
    };

    const result = await service.createDirectWithPricing(
      { ...baseDefinition, invoice_number: "INV-PRICING-002" },
      [line],
      pricingService,
      { price_type: "SALE", as_of: "2026-08-14T10:00:00Z", rate_list_id: 22 },
      350,
      0,
      350,
      0,
    );

    expect(result.invoice.lines[0]?.unit_price).toBe(175);
    expect(result.invoice.lines[0]?.pricing_source).toBe("MANUAL_OVERRIDE");
  });
});
