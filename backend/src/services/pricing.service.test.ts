import { describe, expect, it } from "vitest";
import { DefaultPricingService, type PricingRepository } from "./pricing.service.js";
import type { PriceResolutionContext, ResolvedPrice } from "../types/pricing.types.js";

const resolved: ResolvedPrice = {
  rate_list_id: 1,
  rate_list_version_id: 2,
  rate_list_item_id: 3,
  product_id: 10,
  unit_price: 1250,
  unit: "bag",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "GLOBAL",
  effective_from: "2026-08-13T00:00:00Z",
};

function repositoryReturning(value: ResolvedPrice | null): PricingRepository {
  return {
    findBestRateListItem: async () => value,
  };
}

describe("DefaultPricingService", () => {
  it("delegates valid resolution context to the repository", async () => {
    const service = new DefaultPricingService(repositoryReturning(resolved));

    const context: PriceResolutionContext = {
      price_type: "SALE",
      product_id: 10,
      quantity: 5,
      as_of: "2026-08-13T10:00:00Z",
      customer_id: 20,
    };

    await expect(service.resolvePrice(context)).resolves.toEqual(resolved);
  });

  it("returns null when no applicable rate exists", async () => {
    const service = new DefaultPricingService(repositoryReturning(null));

    await expect(
      service.resolvePrice({
        price_type: "PURCHASE",
        product_id: 10,
        quantity: 1,
        as_of: "2026-08-13T10:00:00Z",
      }),
    ).resolves.toBeNull();
  });

  it("rejects invalid quantities", async () => {
    const service = new DefaultPricingService(repositoryReturning(resolved));

    await expect(
      service.resolvePrice({
        price_type: "SALE",
        product_id: 10,
        quantity: 0,
        as_of: "2026-08-13T10:00:00Z",
      }),
    ).rejects.toThrow("quantity must be greater than zero");
  });
});
