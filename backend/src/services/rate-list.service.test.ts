import { describe, expect, it } from "vitest";
import { DefaultRateListService, type RateListRepository } from "./rate-list.service.js";
import type { RateListDefinition } from "../types/pricing.types.js";

const valid: RateListDefinition = {
  name: "Default Sale Rates",
  code: "SALE-DEFAULT",
  price_type: "SALE",
  scope_type: "GLOBAL",
  currency_code: "PKR",
};

function repository(): RateListRepository {
  return {
    createRateList: async (input) => ({ id: 1, ...input }),
    createVersion: async (input) => ({ id: 2, ...input }),
    replaceVersionItems: async (_versionId, items) => items,
  };
}

describe("DefaultRateListService", () => {
  it("accepts a valid global rate list", async () => {
    const service = new DefaultRateListService(repository());
    await expect(service.createRateList(valid)).resolves.toMatchObject({ id: 1, code: "SALE-DEFAULT" });
  });

  it("rejects an invalid scope owner combination", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.createRateList({ ...valid, scope_type: "GLOBAL", vendor_id: 4 }),
    ).rejects.toThrow("global rate lists cannot have vendor_id or customer_id");
  });

  it("rejects duplicate product quantity tiers", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.replaceVersionItems(2, [
        { rate_list_version_id: 2, product_id: 10, minimum_quantity: 1, unit_price: 100, unit: "bag" },
        { rate_list_version_id: 2, product_id: 10, minimum_quantity: 1, unit_price: 95, unit: "bag" },
      ]),
    ).rejects.toThrow("duplicate rate-list tier: 10:1");
  });

  it("rejects an invalid effective-date range", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.createVersion({
        rate_list_id: 1,
        version_number: 1,
        effective_from: "2026-08-14T00:00:00Z",
        effective_to: "2026-08-13T00:00:00Z",
      }),
    ).rejects.toThrow("effective_to must be later than effective_from");
  });
});
