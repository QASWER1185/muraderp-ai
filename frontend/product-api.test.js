import { afterEach, describe, expect, it, vi } from "vitest";
import { createProduct, getProduct, listProducts, ProductApiError, updateProduct } from "./product-api.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Product browser API", () => {
  it("sends exact and partial search through the authenticated gateway", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [], next_cursor: null }) });
    vi.stubGlobal("fetch", fetch);
    await listProducts(context, { search: "  Popular pipe  ", limit: 25 });
    expect(fetch).toHaveBeenCalledWith("/api/v1/products?limit=25&search=Popular+pipe", expect.objectContaining({ credentials: "include", headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId } }));
  });

  it("loads detail without exposing an internal service token", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 7 } }) });
    vi.stubGlobal("fetch", fetch);
    await getProduct(context, 7);
    const options = fetch.mock.calls[0][1];
    expect(options.headers.Authorization).toBeUndefined();
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/products/7");
  });

  it("preserves status and server error information", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN", message: "Denied" } }) }));
    await expect(listProducts(context)).rejects.toMatchObject({ name: "ProductApiError", status: 403, code: "FORBIDDEN", message: "Denied" });
    expect(ProductApiError.prototype).toBeInstanceOf(Error);
  });

  it("creates a Product through the authenticated browser route", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 8 } }) });
    vi.stubGlobal("fetch", fetch);
    const draft = { name: "Test Pipe", sku: "TEST-PIPE", category: "Pipe", unit: "pcs", purchase_price: 5, sale_price: 10, brand_id: null };
    await createProduct(context, draft);
    expect(fetch).toHaveBeenCalledWith("/api/v1/products", {
      credentials: "include", method: "POST", body: JSON.stringify(draft),
      headers: { "Content-Type": "application/json", "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId },
    });
  });

  it("edits a Product through the authenticated browser route and keeps permission errors", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN", message: "Denied" } }) });
    vi.stubGlobal("fetch", fetch);
    await expect(updateProduct(context, 8, { name: "Updated Pipe" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/products/8", {
      credentials: "include", method: "PATCH", body: JSON.stringify({ name: "Updated Pipe" }),
      headers: { "Content-Type": "application/json", "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId },
    });
  });
});
