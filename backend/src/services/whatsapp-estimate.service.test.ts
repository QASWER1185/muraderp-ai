import { describe, expect, it } from "vitest";
import { WhatsAppEstimateService } from "./whatsapp-estimate.service.js";
import type { EstimateDocument } from "../types/estimate-document.types.js";

const estimate: EstimateDocument = {
  id: 1,
  status: "READY",
  definition: { organization_id: "11111111-1111-4111-8111-111111111111", branch_id: "22222222-2222-4222-8222-222222222222", customer_id: 7, estimate_number: "EST-100", issue_date: "2026-09-11", currency_code: "PKR" },
  lines: [{ line_number: 1, product_id: 10, quantity: 2, unit: "bag", unit_price: 1500, pricing_source: "MANUAL_OVERRIDE" }],
  totals: { subtotal: 3000, discount_total: 0, grand_total: 3000, pass_through_rent: 200, customer_payable_total: 3200 },
};

describe("WhatsAppEstimateService", () => {
  it("builds a universal WhatsApp link with normalized phone and prepared message", () => {
    const delivery = new WhatsAppEstimateService().prepareDelivery(estimate, "0300-1234567");

    expect(delivery.mode).toBe("WEB_LINK");
    expect(delivery.phone).toBe("923001234567");
    expect(delivery.document_name).toBe("EST-100.pdf");
    expect(delivery.message).toContain("EST-100");
    expect(delivery.message).toContain("3200 PKR");
    expect(delivery.share_url).toBe(`https://wa.me/923001234567?text=${encodeURIComponent(delivery.message)}`);
  });

  it("rejects an invalid destination phone", () => {
    expect(() => new WhatsAppEstimateService().prepareDelivery(estimate, "12345")).toThrow("valid Pakistan mobile number");
  });
});
