import { describe, expect, it } from "vitest";
import { DefaultRateListService } from "./rate-list.service.js";
import type { RateListRepository } from "../repositories/rate-list.repository.js";
import type { RateListDefinition } from "../types/pricing.types.js";

const valid: RateListDefinition = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  name: "Default Sale Rates",
  code: "SALE-DEFAULT",
  price_type: "SALE",
  scope_type: "GLOBAL",
  currency_code: "PKR",
};

function repository(): RateListRepository {
  return {
    createRateList: async (input) => ({
      id: 1,
      ...input,
      is_active: input.is_active ?? true,
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:00Z",
    }),
    createVersion: async (input) => ({
      id: 2,
      ...input,
      status: input.status ?? "DRAFT",
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:00Z",
    }),
    createItem: async (input) => ({
      id: 3,
      ...input,
      minimum_quantity: input.minimum_quantity ?? 1,
      created_at: "2026-08-13T00:00:00Z",
      updated_at: "2026-08-13T00:00:00Z",
    }),
    createDraftVersion: async (input) => ({
      version: { id: 4, rate_list_id: input.rate_list_id, version_number: input.version_number, status: "DRAFT", effective_from: input.effective_from, created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z" },
      items: input.items.map((item, index) => ({ id: index + 10, rate_list_version_id: 4, ...item, created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z" })),
    }),
    listActiveSaleRateLists: async () => [],
    findBestRateListItem: async () => null,
    findRateListsByHint: async () => [],
  };
}

describe("DefaultRateListService", () => {
  it("accepts a valid global rate list", async () => {
    const service = new DefaultRateListService(repository());
    await expect(service.createRateList(valid)).resolves.toMatchObject({
      id: 1,
      code: "SALE-DEFAULT",
    });
  });

  it("normalizes identity fields before persistence", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.createRateList({
        ...valid,
        name: "  Sale Rates ",
        code: " SALE-001 ",
        currency_code: " pkr ",
      }),
    ).resolves.toMatchObject({
      name: "Sale Rates",
      code: "SALE-001",
      currency_code: "PKR",
    });
  });

  it("rejects an invalid scope owner combination", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.createRateList({ ...valid, scope_type: "GLOBAL", vendor_id: 4 }),
    ).rejects.toThrow("global rate lists cannot have vendor_id or customer_id");
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

  it("rejects an invalid price item", async () => {
    const service = new DefaultRateListService(repository());
    await expect(
      service.createItem({
        rate_list_version_id: 2,
        product_id: 10,
        minimum_quantity: 1,
        unit_price: -1,
        unit: "bag",
      }),
    ).rejects.toThrow("unit_price must be zero or greater");
  });

  it("imports a confirmed proposal as a draft version", async () => {
    const service = new DefaultRateListService(repository());
    await expect(service.createDraftVersion({
      organization_id: valid.organization_id,
      rate_list_id: 1,
      version_number: 2,
      effective_from: "2026-09-15T00:00:00Z",
      items: [{ product_id: 10, minimum_quantity: 1, unit_price: 1525, unit: " bag " }],
    })).resolves.toMatchObject({ version: { status: "DRAFT", version_number: 2 }, items: [{ unit: "bag" }] });
  });

  it("rejects duplicate product quantity tiers before persistence", async () => {
    const service = new DefaultRateListService(repository());
    await expect(service.createDraftVersion({
      organization_id: valid.organization_id,
      rate_list_id: 1,
      version_number: 2,
      effective_from: "2026-09-15T00:00:00Z",
      items: [
        { product_id: 10, minimum_quantity: 1, unit_price: 1525, unit: "bag" },
        { product_id: 10, minimum_quantity: 1, unit_price: 1500, unit: "bag" },
      ],
    })).rejects.toThrow("duplicate product/quantity tier");
  });
});
