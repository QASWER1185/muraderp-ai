import { afterEach, describe, expect, it, vi } from "vitest";
import { createInvoice, createInvoiceFromEstimate, getInvoice, getReadyEstimate, listInvoices, listReadyEstimates } from "./invoice-api.js";
import { invoiceDetailMarkup, invoiceListMarkup, validateInvoiceDraft } from "./invoices.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Invoice browser integration", () => {
  it("uses only same-origin authenticated API paths with central workspace context", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listInvoices(context, { limit: 25 });
    await getInvoice(context, 9);
    await createInvoice(context, { invoice_number: "INV-9" }, "key-9");
    await listReadyEstimates(context);
    await getReadyEstimate(context, 41);
    await createInvoiceFromEstimate(context, { source_estimate_id: 41 }, "estimate-41-key");
    for (const [path, options] of fetch.mock.calls) {
      expect(path).toMatch(/^\/api\/v1\/invoices/);
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Organization-Id"]).toBe(context.organizationId);
      expect(options.headers["X-Branch-Id"]).toBe(context.branchId);
    }
    expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe("key-9");
    expect(fetch.mock.calls[5][1].headers["Idempotency-Key"]).toBe("estimate-41-key");
  });

  it("requires explicit cost and a positive posted total", () => {
    const input = { invoice_number: "INV-9", customer_id: "7", warehouse_id: "4", issue_date: "2026-09-28", discount_total: "5", pass_through_rent: "0", lines: [{ product_id: "9", quantity: "2", unit: "bag", unit_price: "100", unit_cost: "70" }] };
    expect(validateInvoiceDraft(input)).toMatchObject({ customer_id: 7, warehouse_id: 4, lines: [{ product_id: 9, unit_cost: 70 }] });
    expect(() => validateInvoiceDraft({ ...input, lines: [{ ...input.lines[0], unit_cost: "" }] })).toThrow("Explicit unit cost");
    expect(() => validateInvoiceDraft({ ...input, discount_total: "200" })).toThrow("Discount");
  });

  it("renders invoice responses without inserting untrusted markup", () => {
    expect(invoiceListMarkup([{ id: 1, invoice_number: "<INV>", issue_date: "2026-09-28", customer_id: 7, status: "POSTED", grand_total: 20 }])).toContain("&lt;INV&gt;");
    expect(invoiceDetailMarkup({ invoice: { invoice_number: "<INV>", status: "POSTED", issue_date: "2026-09-28", customer_id: 7, warehouse_id: 4, subtotal: 20, discount_total: 0, grand_total: 20, pass_through_rent: 0 }, lines: [{ product_id: 9, quantity: 1, unit: "bag", unit_price: 20, line_total: 20 }] })).not.toContain("<INV>");
  });
});
