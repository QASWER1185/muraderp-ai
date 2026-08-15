import { describe, expect, it, vi } from "vitest";
import { DefaultEstimatePricingService } from "../src/services/estimate-pricing.integration.js";
import type { PricingService } from "../src/services/pricing.service.js";
import type { ResolvedPrice } from "../src/types/pricing.types.js";

const resolved: ResolvedPrice = {
  rate_list_id: 4,
  rate_list_version_id: 8,
  rate_list_item_id: 12,
  product_id: 25,
  unit_price: 185,
  unit: "pcs",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "GLOBAL",
  effective_from: "2026-08-15T00:00:00Z",
};

describe("DefaultEstimatePricingService", () => {
  it("automatically applies the selected rate-list price", async () => {
    const pricing = { resolveCandidate: vi.fn().mockResolvedValue(resolved) } as unknown as PricingService;
    const service = new DefaultEstimatePricingService(pricing);

    const result = await service.priceLine(
      { line_number: 1, product_id: 25, quantity: 50, unit: "pcs", rate_list_id: 4 },
      { price_type: "SALE", as_of: "2026-08-15T10:00:00Z", customer_id: 7 },
    );

    expect(result.unit_price).toBe(185);
    expect(result.pricing_source).toBe("RESOLVED_RATE");
    expect(result.resolved_price).toEqual(resolved);
    expect(pricing.resolveCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: 25, quantity: 50, selected_rate_list_id: 4 }),
      expect.objectContaining({ price_type: "SALE", customer_id: 7 }),
    );
  });

  it("keeps an explicit manual price as a manual override", async () => {
    const pricing = { resolveCandidate: vi.fn() } as unknown as PricingService;
    const service = new DefaultEstimatePricingService(pricing);

    const result = await service.priceLine(
      { line_number: 1, product_id: 25, quantity: 50, unit: "pcs", unit_price: 210 },
      { price_type: "SALE", as_of: "2026-08-15T10:00:00Z", customer_id: 7 },
    );

    expect(result.unit_price).toBe(210);
    expect(result.pricing_source).toBe("MANUAL_OVERRIDE");
    expect(pricing.resolveCandidate).not.toHaveBeenCalled();
  });

  it("does not fabricate a price when resolution is unavailable", async () => {
    const pricing = { resolveCandidate: vi.fn().mockResolvedValue(null) } as unknown as PricingService;
    const service = new DefaultEstimatePricingService(pricing);

    await expect(service.priceLine(
      { line_number: 1, product_id: 25, quantity: 50, unit: "pcs", rate_list_id: 4 },
      { price_type: "SALE", as_of: "2026-08-15T10:00:00Z", customer_id: 7 },
    )).rejects.toThrow("unable to resolve price for estimate line 1");
  });
});
