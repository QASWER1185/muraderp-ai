import { describe, expect, it } from "vitest";
import { DefaultEstimateShareService } from "./estimate-share.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";

const estimate: EstimateDocument = {
  id: 1,
  status: "DRAFT",
  definition: { customer_id: 7, estimate_number: "EST-0001", issue_date: "2026-08-13", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, pricing_source: "RESOLVED_RATE" }],
  totals: { subtotal: 10000, discount_total: 500, grand_total: 9500, customer_payable_total: 10500, pass_through_rent: 1000 },
};

describe("DefaultEstimateShareService", () => {
  it("builds a one-click WhatsApp share payload", () => {
    const result = new DefaultEstimateShareService().buildWhatsAppShare(estimate, "CLASSIC_PAKISTAN", undefined, "Ali");
    expect(result.channel).toBe("WHATSAPP");
    expect(result.document.format).toBe("SHARE");
    expect(result.message).toContain("Dear Ali,");
    expect(result.message).toContain("EST-0001");
    expect(result.message).toContain("10500 PKR");
    expect(result.document.model.header.business_name).toBe("M MURAD BUILDING MATERIALS STORE");
  });
});
