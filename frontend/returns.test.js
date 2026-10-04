import { afterEach, describe, expect, it, vi } from "vitest";
import { createReturn, getReturn, listReturns } from "./return-api.js";
import { returnDetailMarkup, returnListMarkup, validateReturnDraft } from "./returns.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("Returns browser integration", () => {
  it("uses authenticated same-origin API paths with central workspace context", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listReturns(context, { limit: 25, search: "CN-17" });
    await getReturn(context, 17);
    await createReturn(context, { credit_note_number: "CN-17" }, "return-key-17");
    for (const [path, options] of fetch.mock.calls) {
      expect(path).toMatch(/^\/api\/v1\/returns/);
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Organization-Id"]).toBe(context.organizationId);
      expect(options.headers["X-Branch-Id"]).toBe(context.branchId);
    }
    expect(fetch.mock.calls[2][1].headers["Idempotency-Key"]).toBe("return-key-17");
    expect(fetch.mock.calls[0][0]).toContain("search=CN-17");
  });

  it("validates selected invoice lines before posting", () => {
    const invoice = { invoice: { id: 10, customer_id: 7, status: "POSTED", currency_code: "PKR" }, lines: [{ id: 31, quantity: 2, unit_price: 100 }] };
    const input = { credit_note_number: "CN-17", credit_date: "2026-09-28", reason: "Damaged item", notes: "", items: [{ invoice_item_id: "31", warehouse_id: "4", quantity: "1" }] };
    expect(validateReturnDraft(input, invoice)).toMatchObject({ invoice_id: 10, customer_id: 7, items: [{ invoice_item_id: 31, warehouse_id: 4, quantity: 1 }] });
    expect(() => validateReturnDraft({ ...input, items: [] }, invoice)).toThrow("Select between");
    expect(() => validateReturnDraft({ ...input, items: [{ ...input.items[0], quantity: "3" }] }, invoice)).toThrow("Return quantity");
    expect(() => validateReturnDraft(input, { ...invoice, invoice: { ...invoice.invoice, status: "VOID" } })).toThrow("posted invoice");
    expect(() => validateReturnDraft(input, { ...invoice, invoice: { ...invoice.invoice, status: "DRAFT" } })).toThrow("posted invoice");
  });

  it("escapes returned data in register and detail", () => {
    expect(returnListMarkup([{ id: 1, credit_note_number: "<CN>", credit_date: "2026-09-28", invoice_id: 7, status: "POSTED", grand_total: 20 }])).toContain("&lt;CN&gt;");
    expect(returnDetailMarkup({ credit_note: { credit_note_number: "<CN>", status: "POSTED", credit_date: "2026-09-28", invoice_id: 7, customer_id: 3, reason: "<bad>", grand_total: 20 }, items: [{ product_id: 9, quantity: 1, unit: "bag", unit_price: 20, warehouse_id: 4, line_total: 20 }] })).not.toContain("<bad>");
  });
});
