import { afterEach, describe, expect, it, vi } from "vitest";
import { productDetailMarkup, productEditorMarkup, productErrorMessage, productPageMarkup, productRowsMarkup, saveProductAndRefresh, validateProductDraft } from "./products.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Product Search experience", () => {
  it("renders searchable product information safely", () => {
    const markup = productRowsMarkup([{ id: 7, name: "<Popular Pipe>", sku: "PP-25", category: "Pipe", unit: "pcs", sale_price: 120, brand_id: 4 }]);
    expect(markup).toContain("&lt;Popular Pipe&gt;");
    expect(markup).toContain("PP-25");
    expect(markup).not.toContain("<Popular Pipe>");
  });

  it("has honest authentication, permission, and missing-service messages", () => {
    expect(productErrorMessage({ status: 401 })).toContain("Sign in");
    expect(productErrorMessage({ status: 403 })).toContain("do not have access");
    expect(productErrorMessage({ status: 404 })).toContain("not connected");
  });

  it("shows New Product while retaining search, refresh, and read-only detail", () => {
    const page = productPageMarkup();
    expect(page).toContain('data-product-new>+ New Product');
    expect(page).toContain('id="product-search-form"');
    expect(page).toContain("data-product-refresh");
    const detail = productDetailMarkup({ id: 8, name: "<Pipe>", sku: "P-8", category: "Pipe", unit: "pcs", purchase_price: 5, sale_price: 10 });
    expect(detail).toContain("&lt;Pipe&gt;");
    expect(detail).toContain("P-8");
    expect(detail).toContain("data-product-edit>Edit Product");
  });

  it("provides a create and edit form with all supported Product fields", () => {
    const form = productEditorMarkup();
    expect(form).toContain('id="product-form"');
    expect(form).toContain("New Product");
    for (const name of ["name", "sku", "category", "unit", "purchase_price", "sale_price", "brand_id"]) expect(form).toContain(`name="${name}"`);
    expect(form).toContain('type="submit">Save Product');
    expect(validateProductDraft({ name: " Pipe ", sku: " P-8 ", category: "Pipe", unit: "pcs", purchase_price: "5", sale_price: "10", brand_id: "" })).toEqual({ name: "Pipe", sku: "P-8", category: "Pipe", unit: "pcs", purchase_price: 5, sale_price: 10, brand_id: null });
    expect(() => validateProductDraft({ name: "Pipe", sku: "P-8", category: "Pipe", unit: "pcs", purchase_price: "-1", sale_price: "10" })).toThrow("Purchase price");
  });

  it("confirms creation in a refreshed authenticated Product list", async () => {
    const draft = { name: "Test Pipe", sku: "TEST-PIPE", category: "Pipe", unit: "pcs", purchase_price: 5, sale_price: 10, brand_id: null };
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 8, ...draft } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 8, ...draft }] }) });
    vi.stubGlobal("fetch", fetch);
    const { listProducts } = await import("./product-api.js");
    const saved = await saveProductAndRefresh(context, null, draft, (sku) => listProducts(context, { search: sku }).then((page) => page.data));
    expect(saved.id).toBe(8);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(fetch.mock.calls[1][0]).toContain("search=TEST-PIPE");
  });

  it("confirms edits after a refreshed list and reports missing refresh results", async () => {
    const updated = { id: 8, name: "Updated Pipe", sku: "TEST-PIPE" };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: updated }) });
    vi.stubGlobal("fetch", fetch);
    const refresh = vi.fn().mockResolvedValue([updated]);
    await expect(saveProductAndRefresh(context, { id: 8 }, { name: updated.name }, refresh)).resolves.toEqual(updated);
    expect(fetch.mock.calls[0][1].method).toBe("PATCH");
    expect(refresh).toHaveBeenCalledWith("TEST-PIPE");
    await expect(saveProductAndRefresh(context, { id: 8 }, { name: updated.name }, async () => [])).rejects.toThrow("could not be confirmed");
  });
});
