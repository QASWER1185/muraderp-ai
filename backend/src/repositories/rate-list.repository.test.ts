import { describe, expect, it } from "vitest";
import { SupabaseRateListRepository } from "./rate-list.repository.js";
import type { PriceResolutionContext } from "../types/pricing.types.js";

class FakeQuery {
  constructor(private readonly rows: unknown[]) {}
  select() { return this; }
  eq() { return this; }
  in() { return this; }
  lte() { return this; }
  order() { return this; }
  then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
    return Promise.resolve(resolve({ data: this.rows, error: null }));
  }
}

describe("SupabaseRateListRepository price resolution", () => {
  it("prefers customer scope, then quantity tier, then effective date", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") {
          return new FakeQuery([
            { id: 1, name: "Global", code: "G", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true },
            { id: 2, name: "Vendor", code: "V", price_type: "SALE", scope_type: "VENDOR", vendor_id: 9, customer_id: null, currency_code: "PKR", is_active: true },
            { id: 3, name: "Customer", code: "C", price_type: "SALE", scope_type: "CUSTOMER", vendor_id: null, customer_id: 7, currency_code: "PKR", is_active: true },
          ]);
        }
        if (table === "rate_list_versions") {
          return new FakeQuery([
            { id: 11, rate_list_id: 1, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
            { id: 22, rate_list_id: 2, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
            { id: 31, rate_list_id: 3, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null },
          ]);
        }
        return new FakeQuery([
          { id: 101, rate_list_version_id: 11, product_id: 10, minimum_quantity: 1, unit_price: 1500, unit: "bag" },
          { id: 201, rate_list_version_id: 22, product_id: 10, minimum_quantity: 1, unit_price: 1400, unit: "bag" },
          { id: 301, rate_list_version_id: 31, product_id: 10, minimum_quantity: 1, unit_price: 1300, unit: "bag" },
          { id: 302, rate_list_version_id: 31, product_id: 10, minimum_quantity: 10, unit_price: 1250, unit: "bag" },
        ]);
      },
    };

    const repository = new SupabaseRateListRepository(() => client as never);
    const context: PriceResolutionContext = {
      price_type: "SALE",
      product_id: 10,
      quantity: 10,
      as_of: "2026-08-14T10:00:00Z",
      vendor_id: 9,
      customer_id: 7,
    };

    await expect(repository.findBestRateListItem(context)).resolves.toMatchObject({
      rate_list_id: 3,
      rate_list_version_id: 31,
      rate_list_item_id: 302,
      unit_price: 1250,
      minimum_quantity: 10,
      scope_type: "CUSTOMER",
    });
  });

  it("honors an explicit rate_list_id and never substitutes another list", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") return new FakeQuery([{ id: 2, name: "Vendor", code: "V", price_type: "SALE", scope_type: "VENDOR", vendor_id: 9, customer_id: null, currency_code: "PKR", is_active: true }]);
        if (table === "rate_list_versions") return new FakeQuery([{ id: 22, rate_list_id: 2, version_number: 1, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null }]);
        return new FakeQuery([{ id: 201, rate_list_version_id: 22, product_id: 10, minimum_quantity: 1, unit_price: 1400, unit: "bag" }]);
      },
    };
    const repository = new SupabaseRateListRepository(() => client as never);
    await expect(repository.findBestRateListItem({ price_type: "SALE", product_id: 10, quantity: 1, as_of: "2026-08-14T10:00:00Z", customer_id: 7, rate_list_id: 2 })).resolves.toMatchObject({ rate_list_id: 2, unit_price: 1400 });
  });

  it("returns null when the effective window is not active", async () => {
    const client = {
      from(table: string) {
        if (table === "rate_lists") return new FakeQuery([{ id: 1, name: "Global", code: "G", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true }]);
        if (table === "rate_list_versions") return new FakeQuery([{ id: 11, rate_list_id: 1, version_number: 1, status: "ACTIVE", effective_from: "2026-09-01T00:00:00Z", effective_to: null }]);
        return new FakeQuery([]);
      },
    };
    const repository = new SupabaseRateListRepository(() => client as never);
    await expect(repository.findBestRateListItem({ price_type: "SALE", product_id: 10, quantity: 1, as_of: "2026-08-14T10:00:00Z" })).resolves.toBeNull();
  });
});
