import { describe, expect, it } from "vitest";
import { SupabasePricingRepository } from "./pricing.repository.js";
import type { PriceResolutionContext } from "../types/pricing.types.js";

function clientFor(rows: unknown[], error: unknown = null) {
  const filters: Array<{ method: string; value: unknown }> = [];
  const query = {
    select: () => query,
    eq: (method: string, value: unknown) => {
      filters.push({ method, value });
      return query;
    },
    lte: (method: string, value: unknown) => {
      filters.push({ method, value });
      return query;
    },
    or: () => query,
    order: () => query,
    limit: async () => ({ data: rows, error }),
  };

  return { from: () => query, filters };
}

const context: PriceResolutionContext = {
  price_type: "SALE",
  product_id: 10,
  quantity: 20,
  as_of: "2026-08-13T10:00:00Z",
  vendor_id: 5,
  customer_id: 7,
};

const row = (scope_type: "GLOBAL" | "VENDOR" | "CUSTOMER", unit_price: number, minimum_quantity: number, effective_from: string) => ({
  id: unit_price,
  product_id: 10,
  minimum_quantity,
  unit_price,
  unit: "bag",
  rate_list_versions: {
    id: unit_price + 100,
    effective_from,
    effective_to: null,
    status: "ACTIVE",
    rate_lists: {
      id: unit_price + 1000,
      price_type: "SALE",
      scope_type,
      vendor_id: scope_type === "VENDOR" ? 5 : null,
      customer_id: scope_type === "CUSTOMER" ? 7 : null,
      currency_code: "PKR",
      is_active: true,
    },
  },
});

describe("SupabasePricingRepository", () => {
  it("prefers customer pricing over vendor and global pricing", async () => {
    const client = clientFor([
      row("GLOBAL", 1500, 1, "2026-08-13T00:00:00Z"),
      row("VENDOR", 1450, 1, "2026-08-13T00:00:00Z"),
      row("CUSTOMER", 1400, 1, "2026-08-13T00:00:00Z"),
    ]);

    const repository = new SupabasePricingRepository(() => client as never);
    const result = await repository.findBestRateListItem(context);

    expect(result?.unit_price).toBe(1400);
    expect(result?.scope_type).toBe("CUSTOMER");
  });

  it("prefers the vendor rate when no matching customer rate exists", async () => {
    const client = clientFor([
      row("GLOBAL", 1500, 1, "2026-08-13T00:00:00Z"),
      row("VENDOR", 1450, 1, "2026-08-13T00:00:00Z"),
      row("CUSTOMER", 1350, 1, "2026-08-13T00:00:00Z"),
    ]);

    const repository = new SupabasePricingRepository(() => client as never);
    const result = await repository.findBestRateListItem({ ...context, customer_id: 999 });

    expect(result?.unit_price).toBe(1450);
    expect(result?.scope_type).toBe("VENDOR");
  });

  it("selects the newest effective version within the winning scope", async () => {
    const client = clientFor([
      row("GLOBAL", 1500, 1, "2026-08-01T00:00:00Z"),
      row("GLOBAL", 1475, 1, "2026-08-13T00:00:00Z"),
    ]);

    const repository = new SupabasePricingRepository(() => client as never);
    const result = await repository.findBestRateListItem({ ...context, vendor_id: null, customer_id: null });

    expect(result?.unit_price).toBe(1475);
    expect(result?.effective_from).toBe("2026-08-13T00:00:00Z");
  });

  it("selects the highest applicable quantity tier", async () => {
    const client = clientFor([
      row("GLOBAL", 1500, 1, "2026-08-13T00:00:00Z"),
      row("GLOBAL", 1450, 10, "2026-08-13T00:00:00Z"),
      row("GLOBAL", 1400, 25, "2026-08-13T00:00:00Z"),
    ]);

    const repository = new SupabasePricingRepository(() => client as never);
    const result = await repository.findBestRateListItem({ ...context, quantity: 20, vendor_id: null, customer_id: null });

    expect(result?.unit_price).toBe(1450);
    expect(result?.minimum_quantity).toBe(10);
  });
});
