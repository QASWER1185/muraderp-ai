import { describe, expect, it } from "vitest";
import { DefaultEstimatePricingService } from "./estimate-pricing.service.js";
import type { PricingService } from "./pricing.service.js";
import type { ResolvedPrice } from "../types/pricing.types.js";

const resolved: ResolvedPrice = {
  rate_list_id: 1,
  rate_list_version_id: 2,
  rate_list_item_id: 3,
  product_id: 10,
  unit_price: 1450,
  unit: "bag",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "VENDOR",
  effective_from: "2026-08-13T00:00:00Z",
};

function pricingService(value: ResolvedPrice | null): PricingService {
  return {
    resolvePrice: async () => value,
    resolveCandidate: async () => value,
  };
}

const baseLine = {
  line_number: 1,
  product_id: 10,
  quantity: 20,
  unit: "bag",
};

const context = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  price_type: "SALE" as const,
  as_of: "2026-08-13T10:00:00Z",
  vendor_id: 5,
  customer_id: 7,
};

describe("DefaultEstimatePricingService", () => {
  it("uses deterministic resolved pricing when no manual price is supplied", async () => {
    const service = new DefaultEstimatePricingService(pricingService(resolved));
    await expect(service.priceLine(baseLine, context)).resolves.toMatchObject({
      unit_price: 1450,
      pricing_source: "RESOLVED_RATE",
      resolved_price: resolved,
    });
  });

  it("preserves an explicit manual price override", async () => {
    const service = new DefaultEstimatePricingService(pricingService(resolved));
    await expect(service.priceLine({ ...baseLine, unit_price: 1500 }, context)).resolves.toMatchObject({
      unit_price: 1500,
      pricing_source: "MANUAL_OVERRIDE",
    });
  });

  it("uses a line-level rate-list selection for mixed-brand estimates", async () => {
    const service = new DefaultEstimatePricingService(pricingService(resolved));
    const line = {
      ...baseLine,
      rate_list_id: 44,
      rate_list_selection_source: "LINE_OVERRIDE" as const,
    };

    await expect(service.priceLine(line, { ...context, rate_list_id: 11 })).resolves.toMatchObject({
      rate_list_id: 1,
      rate_list_selection_source: "LINE_OVERRIDE",
      pricing_source: "RESOLVED_RATE",
    });
  });

  it("uses the estimate-level rate-list when no line override is supplied", async () => {
    const service = new DefaultEstimatePricingService(pricingService(resolved));
    const pricing = service.priceLine(baseLine, { ...context, rate_list_id: 22 });

    await expect(pricing).resolves.toMatchObject({
      rate_list_selection_source: "ESTIMATE_DEFAULT",
      pricing_source: "RESOLVED_RATE",
    });
  });

  it("fails safely when no applicable rate exists", async () => {
    const service = new DefaultEstimatePricingService(pricingService(null));
    await expect(service.priceLine(baseLine, context)).rejects.toThrow(
      "no applicable price found for product_id 10",
    );
  });
});
