import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateList, createRateListVersion, getRateList, listRateLists, publishRateListVersion, resolveRateListPrice } from "./rate-list-api.js";
import { rateListDetailMarkup, validateRateList, validateRateListVersion } from "./rate-lists.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Rate List browser integration", () => {
  it("sends all workflow operations to the authenticated backend with workspace headers", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) }); vi.stubGlobal("fetch", fetch);
    await listRateLists(context); await getRateList(context, 5);
    await createRateList(context, { name: "Test" });
    await createRateListVersion(context, 5, { version_number: 1 });
    await publishRateListVersion(context, 5, 11);
    await resolveRateListPrice(context, 5, { product_id: 9, quantity: 2, as_of: "2026-09-30" });
    expect(fetch.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/rate-lists", "/api/v1/rate-lists/5", "/api/v1/rate-lists", "/api/v1/rate-lists/5/versions", "/api/v1/rate-lists/5/versions/11/publish", "/api/v1/rate-lists/5/price?product_id=9&quantity=2&as_of=2026-09-30",
    ]);
    for (const [, options] of fetch.mock.calls) { expect(options.credentials).toBe("include"); expect(options.headers["X-Organization-Id"]).toBe(context.organizationId); expect(options.headers["X-Branch-Id"]).toBe(context.branchId); }
  });

  it("validates scope, product rates and duplicate tiers before submission", () => {
    expect(validateRateList({ name: "Sale", code: "S", price_type: "SALE", scope_type: "GLOBAL" })).toMatchObject({ scope_type: "GLOBAL", currency_code: "PKR" });
    expect(() => validateRateList({ name: "Sale", code: "S", price_type: "SALE", scope_type: "VENDOR", owner_id: "8" })).toThrow("scope");
    const products = [{ id: 9, unit: "bag" }];
    const row = { product_id: "9", minimum_quantity: "1", unit_price: "100" };
    expect(validateRateListVersion({ version_number: "1", effective_from: "2026-09-30", items: [row] }, products).items[0]).toEqual({ product_id: 9, minimum_quantity: 1, unit_price: 100, unit: "bag" });
    expect(() => validateRateListVersion({ version_number: "1", effective_from: "2026-09-30", items: [row, row] }, products)).toThrow("Duplicate");
    expect(() => validateRateListVersion({ version_number: "1", effective_from: "2026-09-30", items: [{ ...row, unit_price: "" }] }, products)).toThrow("Rate");
  });

  it("shows version status and escaped product identity in detail", () => {
    const html = rateListDetailMarkup({ list: { id: 5, name: "<Sale>", code: "S", price_type: "SALE", scope_type: "GLOBAL", currency_code: "PKR" }, versions: [{ id: 11, version_number: 1, status: "ACTIVE", effective_from: "2026-09-30", items: [{ product_id: 9, product: { name: "<Cement>", sku: "CEM", brand_id: 2 }, minimum_quantity: 1, unit_price: 100, unit: "bag" }] }] });
    expect(html).toContain("&lt;Sale&gt;"); expect(html).toContain("&lt;Cement&gt;"); expect(html).toContain("ACTIVE"); expect(html).toContain("Brand #2");
  });
});
