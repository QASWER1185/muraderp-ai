import { describe, expect, it } from "vitest";
import { DefaultPricingService } from "./pricing.service.js";

const service = new DefaultPricingService({
  findBestRateListItem: async () => null,
});

const valid = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  price_type: "SALE" as const,
  product_id: 10,
  quantity: 1,
  as_of: "2026-08-13T10:00:00Z",
};

describe("pricing context validation", () => {
  it("rejects a non-positive product id", async () => {
    await expect(service.resolvePrice({ ...valid, product_id: 0 })).rejects.toThrow(
      "product_id must be a positive integer",
    );
  });

  it("rejects invalid customer ids", async () => {
    await expect(service.resolvePrice({ ...valid, customer_id: -1 })).rejects.toThrow(
      "customer_id must be a positive integer when provided",
    );
  });

  it("rejects invalid vendor ids", async () => {
    await expect(service.resolvePrice({ ...valid, vendor_id: 0 })).rejects.toThrow(
      "vendor_id must be a positive integer when provided",
    );
  });
});
