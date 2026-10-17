import { afterEach, describe, expect, it, vi } from "vitest";
import { listStockBalances, listStockMovements } from "./stock-api.js";
import { stockBalancesMarkup, stockMovementsMarkup } from "./stock.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Stock browser integration", () => {
  it("passes the authorized workspace to read-only same-origin stock endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listStockBalances(context, { limit: 25 });
    await listStockMovements(context, { cursor: 12 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/browser/stock/balances?limit=25",
      "/api/v1/browser/stock/movements?limit=50&cursor=12",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers).toEqual({ "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId });
    }
  });

  it("shows purchase-linked movement and stock without trusting record text as markup", () => {
    const products = [{ id: 31, name: "<Cement>", sku: "CEM", unit: "bag" }];
    const warehouses = [{ id: 4, name: "Main & Store" }];
    const balances = stockBalancesMarkup([{ product_id: 31, warehouse_id: 4, quantity: 2 }], products, warehouses);
    const movements = stockMovementsMarkup([{ product_id: 31, warehouse_id: 4, movement_type: "PURCHASE", quantity: 2, reference_type: "PURCHASE", reference_id: 17 }], products, warehouses);
    expect(balances).toContain("&lt;Cement&gt;");
    expect(balances).toContain("Main &amp; Store");
    expect(movements).toContain("PURCHASE #17");
    expect(movements).not.toContain("<Cement>");
  });
});
