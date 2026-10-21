import { afterEach, describe, expect, it, vi } from "vitest";
import { createPurchase, getPurchase, listPurchases } from "./purchase-api.js";
import { purchaseDetailMarkup, purchaseListMarkup, validatePurchaseDraft } from "./purchases.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Purchases browser integration", () => {
  it("uses authenticated same-origin API paths with central workspace context", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listPurchases(context, { limit: 25 });
    await getPurchase(context, 17);
    await createPurchase(context, { vendor_id: 7 }, "purchase-key-17");
    for (const [path, options] of fetch.mock.calls) {
      expect(path).toMatch(/^\/api\/v1\/browser\/purchases/);
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Organization-Id"]).toBe(context.organizationId);
      expect(options.headers["X-Branch-Id"]).toBe(context.branchId);
    }
    expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe("purchase-key-17");
  });

  it("validates a purchase before posting", () => {
    const input = { vendor_id: "7", warehouse_id: "4", purchase_date: "2026-09-28", invoice_number: "SUP-17", items: [{ product_id: "31", quantity: "2", unit_cost: "100" }], discount: "5", tax: "10", notes: "" };
    expect(validatePurchaseDraft(input)).toMatchObject({ vendor_id: 7, warehouse_id: 4, items: [{ product_id: 31, quantity: 2, unit_cost: 100 }], discount: 5, tax: 10 });
    expect(() => validatePurchaseDraft({ ...input, items: [] })).toThrow("between 1 and 500");
    expect(() => validatePurchaseDraft({ ...input, items: [{ ...input.items[0], unit_cost: "0" }] })).toThrow("Unit cost");
    expect(() => validatePurchaseDraft({ ...input, discount: "210" })).toThrow("Discount");
  });

  it("escapes purchase data in register and detail", () => {
    expect(purchaseListMarkup([{ id: 1, invoice_number: "<SUP>", purchase_date: "2026-09-28", vendor_id: 7, total: 20 }])).toContain("&lt;SUP&gt;");
    expect(purchaseDetailMarkup({ purchase: { id: 1, invoice_number: "<SUP>", purchase_date: "2026-09-28", vendor_id: 7, warehouse_id: 4, subtotal: 20, discount: 0, tax: 0, total: 20, notes: "<bad>" }, items: [{ product_id: 31, quantity: 1, unit_cost: 20, total_cost: 20 }] })).not.toContain("<bad>");
  });
});
