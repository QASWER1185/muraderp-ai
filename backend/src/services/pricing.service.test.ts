import { describe, expect, it, vi } from "vitest";
import {
  DefaultPricingService,
  DefaultRateListAuthoringService,
  type PricingRepository,
} from "./pricing.service.js";
import type {
  PriceResolutionContext,
  RateListItemDefinition,
  RateListVersionDefinition,
  ResolvedPrice,
} from "../types/pricing.types.js";
import type {
  RateListItemRecord,
  RateListRecord,
  RateListVersionRecord,
} from "../repositories/rate-list.repository.js";

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
  return { findBestRateListItem: async () => value };
}

function authoringRepository() {
  const rateList: RateListRecord = {
    id: 1,
    name: "Bestway Sale",
    code: "BESTWAY-SALE",
    price_type: "SALE",
    scope_type: "GLOBAL",
    vendor_id: null,
    customer_id: null,
    currency_code: "PKR",
    is_active: true,
    created_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
  };
  const version: RateListVersionRecord = {
    id: 2,
    rate_list_id: 1,
    version_number: 1,
    status: "DRAFT",
    effective_from: "2026-08-13T00:00:00Z",
    effective_to: null,
    created_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
  };
  const item: RateListItemRecord = {
    id: 3,
    rate_list_version_id: 2,
    product_id: 10,
    minimum_quantity: 1,
    unit_price: 1500,
    unit: "bag",
    created_at: "2026-08-13T00:00:00Z",
    updated_at: "2026-08-13T00:00:00Z",
  };

  return {
    createRateList: vi.fn(async () => rateList),
    createVersion: vi.fn(async () => version),
    createItem: vi.fn(async () => item),
    listActiveSaleRateLists: vi.fn(async () => [rateList]),
    findBestRateListItem: vi.fn(async () => resolved),
    getVersion: vi.fn(async () => version),
    activateVersion: vi.fn(async () => ({ ...version, status: "ACTIVE" as const })),
    archiveVersion: vi.fn(async () => ({ ...version, status: "ARCHIVED" as const })),
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

describe("DefaultRateListAuthoringService", () => {
  it("normalizes authored rate-list metadata before persistence", async () => {
    const repository = authoringRepository();
    const service = new DefaultRateListAuthoringService(repository, repository);
    await service.createRateList({
      name: "  My Brand Rates  ",
      code: "  brand-sale ",
      price_type: "SALE",
      scope_type: "GLOBAL",
      currency_code: "pkR",
    });
    expect(repository.createRateList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "My Brand Rates",
        code: "brand-sale",
        currency_code: "PKR",
      }),
    );
  });

  it("rejects a global rate list with vendor or customer scope", async () => {
    const repository = authoringRepository();
    const service = new DefaultRateListAuthoringService(repository, repository);
    await expect(
      service.createRateList({
        name: "Rates",
        code: "R",
        price_type: "SALE",
        scope_type: "GLOBAL",
        vendor_id: 5,
        currency_code: "PKR",
      }),
    ).rejects.toThrow("GLOBAL rate lists cannot target a vendor or customer");
  });

  it("rejects invalid version windows", async () => {
    const repository = authoringRepository();
    const service = new DefaultRateListAuthoringService(repository, repository);
    const version: RateListVersionDefinition = {
      rate_list_id: 1,
      version_number: 1,
      effective_from: "2026-08-14T10:00:00Z",
      effective_to: "2026-08-14T09:00:00Z",
    };
    await expect(service.createVersion(version)).rejects.toThrow(
      "effective_to must be later than effective_from",
    );
  });

  it("validates rate-list items before persistence", async () => {
    const repository = authoringRepository();
    const service = new DefaultRateListAuthoringService(repository, repository);
    const item: RateListItemDefinition = {
      rate_list_version_id: 1,
      product_id: 10,
      minimum_quantity: 0,
      unit_price: 100,
      unit: "bag",
    };
    await expect(service.createItem(item)).rejects.toThrow(
      "minimum_quantity must be greater than zero",
    );
  });

  it("enforces draft-to-active and active-to-archived lifecycle transitions", async () => {
    const repository = authoringRepository();
    const service = new DefaultRateListAuthoringService(repository, repository);
    await expect(service.activateVersion(2)).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(service.archiveVersion(2)).resolves.toMatchObject({ status: "ARCHIVED" });
    expect(repository.activateVersion).toHaveBeenCalledWith(2);
    expect(repository.archiveVersion).toHaveBeenCalledWith(2);
  });
});
