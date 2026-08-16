import { describe, expect, it } from "vitest";
import { SupabaseRateListRepository } from "../src/repositories/rate-list.repository.js";
import { DefaultPricingService } from "../src/services/pricing.service.js";

const rateLists = [
  { id: 1, name: "Global Sale", code: "GLOBAL", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 2, name: "Vendor Sale", code: "VENDOR-2", price_type: "SALE", scope_type: "VENDOR", vendor_id: 20, customer_id: null, currency_code: "PKR", is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 3, name: "Customer Sale", code: "CUSTOMER-30", price_type: "SALE", scope_type: "CUSTOMER", vendor_id: null, customer_id: 30, currency_code: "PKR", is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
];

const versions = [
  { id: 101, rate_list_id: 1, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 201, rate_list_id: 2, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 301, rate_list_id: 3, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: "2026-07-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 302, rate_list_id: 3, version_number: 2, status: "ACTIVE", effective_from: "2026-07-01T00:00:00Z", effective_to: null, created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
];

const items = [
  { id: 1001, rate_list_version_id: 101, product_id: 500, minimum_quantity: 1, unit_price: 120, unit: "bag", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 2001, rate_list_version_id: 201, product_id: 500, minimum_quantity: 1, unit_price: 110, unit: "bag", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 3001, rate_list_version_id: 301, product_id: 500, minimum_quantity: 1, unit_price: 105, unit: "bag", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
  { id: 3002, rate_list_version_id: 302, product_id: 500, minimum_quantity: 1, unit_price: 103, unit: "bag", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
  { id: 3003, rate_list_version_id: 302, product_id: 500, minimum_quantity: 10, unit_price: 99, unit: "bag", created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z" },
];

function clientFor(dataByTable: Record<string, unknown[]>) {
  return {
    from(table: string) {
      const result = { data: dataByTable[table] ?? [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "lte", "order", "update", "insert"]) builder[method] = () => builder;
      builder.single = async () => result;
      builder.then = (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve);
      return builder;
    },
  };
}

describe("Phase 23 Stage 5 — deterministic pricing regression", () => {
  it("uses CUSTOMER > VENDOR > GLOBAL precedence and the newest effective version with the highest quantity tier", async () => {
    const repository = new SupabaseRateListRepository(() => clientFor({ rate_lists: rateLists, rate_list_versions: versions, rate_list_items: items }) as never);
    const resolved = await repository.findBestRateListItem({
      price_type: "SALE",
      product_id: 500,
      quantity: 10,
      as_of: "2026-08-16T12:00:00Z",
      vendor_id: 20,
      customer_id: 30,
    });

    expect(resolved).toMatchObject({
      rate_list_id: 3,
      rate_list_version_id: 302,
      rate_list_item_id: 3003,
      unit_price: 99,
      minimum_quantity: 10,
      scope_type: "CUSTOMER",
    });
  });

  it("honors an explicitly selected rate list instead of falling back to contextual pricing", async () => {
    const repository = new SupabaseRateListRepository(() => clientFor({ rate_lists: rateLists, rate_list_versions: versions, rate_list_items: items }) as never);
    const resolved = await repository.findBestRateListItem({
      price_type: "SALE",
      product_id: 500,
      quantity: 1,
      as_of: "2026-08-16T12:00:00Z",
      vendor_id: 20,
      customer_id: 30,
      rate_list_id: 2,
    });

    expect(resolved).toMatchObject({ rate_list_id: 2, unit_price: 110, scope_type: "VENDOR" });
  });

  it("rejects ambiguous winning-scope pricing instead of silently choosing one list", async () => {
    const ambiguousCustomer = { ...rateLists[2], id: 4, name: "Customer Sale 2", code: "CUSTOMER-30-B" };
    const repository = new SupabaseRateListRepository(() => clientFor({ rate_lists: [...rateLists, ambiguousCustomer], rate_list_versions: versions, rate_list_items: items }) as never);

    await expect(repository.findBestRateListItem({
      price_type: "SALE",
      product_id: 500,
      quantity: 1,
      as_of: "2026-08-16T12:00:00Z",
      customer_id: 30,
    })).rejects.toThrow("Ambiguous pricing");
  });

  it("returns null when no deterministic product price exists", async () => {
    const repository = new SupabaseRateListRepository(() => clientFor({ rate_lists: rateLists, rate_list_versions: versions, rate_list_items: items }) as never);
    const resolved = await repository.findBestRateListItem({
      price_type: "SALE",
      product_id: 999,
      quantity: 1,
      as_of: "2026-08-16T12:00:00Z",
    });

    expect(resolved).toBeNull();
  });

  it("keeps AI/voice/OCR candidate handling limited to deterministic rate-list context", async () => {
    const repository = {
      findBestRateListItem: async (context: any) => ({
        rate_list_id: context.rate_list_id ?? 3,
        rate_list_version_id: 302,
        rate_list_item_id: 3003,
        product_id: context.product_id,
        unit_price: 99,
        unit: "bag",
        currency_code: "PKR",
        minimum_quantity: 10,
        scope_type: "CUSTOMER" as const,
        effective_from: "2026-07-01T00:00:00Z",
      }),
    };
    const service = new DefaultPricingService(repository);
    const resolved = await service.resolveCandidate(
      { product_id: 500, quantity: 10, selection_source: "OCR_BRAND_MATCH", selected_rate_list_id: 3 },
      { price_type: "SALE", as_of: "2026-08-16T12:00:00Z", customer_id: 30, vendor_id: 20 },
    );

    expect(resolved?.unit_price).toBe(99);
    expect(resolved?.rate_list_id).toBe(3);
  });
});
