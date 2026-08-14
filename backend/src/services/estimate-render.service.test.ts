import { describe, expect, it } from "vitest";
import { DefaultEstimateRenderService } from "./estimate-render.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";

const estimate: EstimateDocument = {
  id: 1,
  status: "DRAFT",
  definition: {
    customer_id: 10,
    estimate_number: "EST-0001",
    issue_date: "2026-08-13",
    currency_code: "PKR",
  },
  lines: [
    { line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" },
  ],
  totals: {
    subtotal: 10000,
    discount_total: 500,
    grand_total: 9500,
    customer_payable_total: 10500,
    pass_through_rent: 1000,
  },
};

describe("DefaultEstimateRenderService", () => {
  it("builds the default Pakistani estimate render model", () => {
    const result = new DefaultEstimateRenderService().buildModel(estimate);

    expect(result.header.business_name).toBe("M MURAD BUILDING MATERIALS STORE");
    expect(result.header.tagline).toBe("SANITARY | ELECTRIC | CEMENT | BRICKS");
    expect(result.header.address).toBe("Al Kabir Town, Raiwind Road, Lahore");
    expect(result.layout.key).toBe("CLASSIC_PAKISTAN");
    expect(result.layout.columns.map((column) => column.key)).toEqual([
      "item_number",
      "item_name",
      "quantity",
      "rate",
      "line_total",
    ]);
    expect(result.layout.summary_order).toEqual([
      "TOTAL",
      "DISCOUNT",
      "GRAND_TOTAL",
      "RENT",
      "NET_PAYABLE",
    ]);
  });

  it("supports selecting another layout", () => {
    const result = new DefaultEstimateRenderService().buildModel(estimate, "DETAILED_COMMERCIAL");
    expect(result.layout.key).toBe("DETAILED_COMMERCIAL");
    expect(result.layout.show_profit_loss).toBe(true);
  });
});
