import { describe, expect, it, vi } from "vitest";
import { DefaultPricingService } from "../src/services/pricing.service.js";
import type { PriceResolutionContext, ResolvedPrice } from "../src/types/pricing.types.js";

const validContext: PriceResolutionContext = {
  price_type: "SALE",
  product_id: 10,
  quantity: 5,
  as_of: "2026-08-13T10:00:00Z",
  customer_id: 7,
};

const resolved: ResolvedPrice = {
  rate_list_id: 1,
  rate_list_version_id: 2,
  rate_list_item_id: 3,
  product_id: 10,
  unit_price: 1400,
  unit: "bag",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "CUSTOMER",
  effective_from: "2026-08-13T00:00:00Z",
};

describe("DefaultPricingService", () => {
  it("delegates valid resolution requests to the repository", async () => {
    const repository = {
      findBestRateListItem: vi.fn().mockResolvedValue(resolved),
    };
    const service = new DefaultPricingService(repository);

    await expect(service.resolvePrice(validContext)).resolves.toEqual(resolved);
    expect(repository.findBestRateListItem).toHaveBeenCalledWith(validContext);
  });

  it("returns null when the repository has no applicable price", async () => {
    const repository = {
      findBestRateListItem: vi.fn().mockResolvedValue(null),
    };
    const service = new DefaultPricingService(repository);

    await expect(service.resolvePrice(validContext)).resolves.toBeNull();
  });

  it.each([
    [{ ...validContext, product_id: 0 }, "product_id must be a positive integer"],
    [{ ...validContext, product_id: 1.5 }, "product_id must be a positive integer"],
    [{ ...validContext, quantity: 0 }, "quantity must be greater than zero"],
    [{ ...validContext, quantity: Number.NaN }, "quantity must be greater than zero"],
    [{ ...validContext, as_of: "not-a-date" }, "as_of must be a valid date/time"],
    [{ ...validContext, rate_list_id: 0 }, "rate_list_id must be a positive integer when provided"],
  ] as const)("rejects invalid context: %s", async (context, message) => {
    const repository = {
      findBestRateListItem: vi.fn(),
    };
    const service = new DefaultPricingService(repository);

    await expect(service.resolvePrice(context)).rejects.toThrow(message);
    expect(repository.findBestRateListItem).not.toHaveBeenCalled();
  });

  it("passes an explicit rate-list selection through unchanged", async () => {
    const repository = {
      findBestRateListItem: vi.fn().mockResolvedValue(resolved),
    };
    const service = new DefaultPricingService(repository);
    const context = { ...validContext, rate_list_id: 99 };

    await service.resolvePrice(context);
    expect(repository.findBestRateListItem).toHaveBeenCalledWith(context);
  });
});
