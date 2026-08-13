import { describe, expect, it } from "vitest";
import { DefaultQuotationService, type QuotationRepository } from "./quotation.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";
import type { QuotationDocument } from "../types/quotation.types.js";

const estimate: EstimateDocument = {
  id: 15,
  status: "READY",
  definition: { customer_id: 7, estimate_number: "EST-0015", issue_date: "2026-08-13", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" }],
  totals: { subtotal: 10000, discount_total: 500, grand_total: 9500, customer_payable_total: 10500, pass_through_rent: 1000 },
};

function repository(): QuotationRepository {
  return { createQuotation: async (quotation) => ({ ...quotation, id: 50 }) };
}

describe("DefaultQuotationService", () => {
  it("converts a ready estimate while preserving commercial values", async () => {
    const result = await new DefaultQuotationService(repository()).convertEstimate(estimate, {
      quotation_number: "QUO-0015",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    });

    expect(result.id).toBe(50);
    expect(result.source_estimate_id).toBe(15);
    expect(result.subtotal).toBe(10000);
    expect(result.discount_total).toBe(500);
    expect(result.grand_total).toBe(9500);
    expect(result.pass_through_rent).toBe(1000);
  });

  it("rejects conversion of a draft estimate", async () => {
    const draft = { ...estimate, status: "DRAFT" as const };
    await expect(new DefaultQuotationService(repository()).convertEstimate(draft, {
      quotation_number: "QUO-0016",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    })).rejects.toThrow("only READY estimates can be converted to quotation");
  });
});
