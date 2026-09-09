import { describe, expect, it, vi } from "vitest";
import { DefaultPricingService } from "../src/services/pricing.service.js";
import type { PriceResolutionContext, ResolvedPrice } from "../src/types/pricing.types.js";

const baseContext: PriceResolutionContext = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  price_type: "SALE",
  product_id: 10,
  quantity: 5,
  as_of: "2026-08-14T10:00:00.000Z",
};

const resolved: ResolvedPrice = {
  rate_list_id: 7,
  rate_list_version_id: 11,
  rate_list_item_id: 42,
  product_id: 10,
  unit_price: 1500,
  unit: "piece",
  currency_code: "PKR",
  minimum_quantity: 5,
  scope_type: "CUSTOMER",
  effective_from: "2026-08-01T00:00:00.000Z",
};

describe("DefaultPricingService", () => {
  it("delegates valid resolution context and returns the resolved price", async () => {
    const findBestRateListItem = vi.fn().mockResolvedValue(resolved);
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice(baseContext)).resolves.toEqual(resolved);
    expect(findBestRateListItem).toHaveBeenCalledOnce();
    expect(findBestRateListItem).toHaveBeenCalledWith(baseContext);
  });

  it("rejects invalid product ids before repository access", async () => {
    const findBestRateListItem = vi.fn();
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, product_id: 0 })).rejects.toThrow("product_id must be a positive integer");
    expect(findBestRateListItem).not.toHaveBeenCalled();
  });

  it("rejects invalid quantities before repository access", async () => {
    const findBestRateListItem = vi.fn();
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, quantity: 0 })).rejects.toThrow("quantity must be greater than zero");
    expect(findBestRateListItem).not.toHaveBeenCalled();
  });

  it("rejects invalid as-of timestamps before repository access", async () => {
    const findBestRateListItem = vi.fn();
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, as_of: "not-a-date" })).rejects.toThrow("as_of must be a valid date/time");
    expect(findBestRateListItem).not.toHaveBeenCalled();
  });

  it("rejects an invalid explicit rate-list id before repository access", async () => {
    const findBestRateListItem = vi.fn();
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, rate_list_id: 0 })).rejects.toThrow("rate_list_id must be a positive integer when provided");
    expect(findBestRateListItem).not.toHaveBeenCalled();
  });

  it("protects explicit rate-list authority from an adapter returning another list", async () => {
    const findBestRateListItem = vi.fn().mockResolvedValue(resolved);
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, rate_list_id: 99 })).rejects.toThrow("resolved price does not belong to the requested rate list");
    expect(findBestRateListItem).toHaveBeenCalledOnce();
  });

  it("allows an explicit rate-list resolution when the authority matches", async () => {
    const findBestRateListItem = vi.fn().mockResolvedValue(resolved);
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice({ ...baseContext, rate_list_id: 7 })).resolves.toEqual(resolved);
  });

  it("returns null when no applicable price exists", async () => {
    const findBestRateListItem = vi.fn().mockResolvedValue(null);
    const service = new DefaultPricingService({ findBestRateListItem });

    await expect(service.resolvePrice(baseContext)).resolves.toBeNull();
  });
});
