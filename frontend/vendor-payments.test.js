import { afterEach, describe, expect, it, vi } from "vitest";
import { createVendorPayment, getVendorPayment, listVendorPayables, listVendorPayments } from "./vendor-payment-api.js";
import { payableListMarkup, validateVendorPaymentDraft, vendorPaymentDetailMarkup, vendorPaymentListMarkup } from "./vendor-payments.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
const payable = { purchase_id: 21, purchase_date: "2026-09-29", invoice_number: null, vendor_id: 9, vendor_name: "Vendor", total: 750, paid: 0, outstanding: 750 };
afterEach(() => vi.unstubAllGlobals());

describe("Vendor Payment browser integration", () => {
  it("uses authenticated workspace APIs and forwards the idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listVendorPayables(context);
    await listVendorPayments(context, { limit: 25 });
    await getVendorPayment(context, 4);
    await createVendorPayment(context, { vendor_id: 9 }, "vendor-payment-key");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/browser/vendor-payments/payables?limit=100",
      "/api/v1/browser/vendor-payments?limit=25",
      "/api/v1/browser/vendor-payments/4",
      "/api/v1/browser/vendor-payments",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Organization-Id"]).toBe(context.organizationId);
      expect(options.headers["X-Branch-Id"]).toBe(context.branchId);
    }
    expect(fetch.mock.calls[3][1].headers["Idempotency-Key"]).toBe("vendor-payment-key");
  });

  it("allocates only to the selected vendor purchase and rejects overpayment", () => {
    const input = { vendor_id: "9", purchase_id: "21", payment_date: "2026-09-29", amount: "25", payment_method: "CASH", reference: "TEST-VP-1", notes: "Test" };
    expect(validateVendorPaymentDraft(input, payable)).toEqual({
      vendor_id: 9, payment_date: "2026-09-29", amount: 25, payment_method: "CASH",
      reference: "TEST-VP-1", notes: "Test", allocations: [{ purchase_id: 21, amount: 25 }],
    });
    expect(() => validateVendorPaymentDraft({ ...input, amount: "751" }, payable)).toThrow("exceeds");
    expect(() => validateVendorPaymentDraft({ ...input, vendor_id: "10" }, payable)).toThrow("authorized vendor");
    expect(() => validateVendorPaymentDraft(input, { ...payable, outstanding: 0 })).toThrow("no outstanding");
    expect(() => validateVendorPaymentDraft({ ...input, payment_method: "CARD" }, payable)).toThrow("payment method");
  });

  it("escapes vendor names and payment references in displayed records", () => {
    expect(payableListMarkup([{ ...payable, vendor_name: "<Vendor>" }])).toContain("&lt;Vendor&gt;");
    expect(vendorPaymentListMarkup([{ id: 4, vendor_name: "<Vendor>", payment_date: "2026-09-29", amount: 25, payment_method: "CASH", reference: "<VP>" }])).toContain("&lt;VP&gt;");
    expect(vendorPaymentDetailMarkup({ payment: { id: 4, vendor_name: "<Vendor>", payment_date: "2026-09-29", amount: 25, payment_method: "CASH", reference: "<VP>", status: "POSTED" }, allocations: [{ purchase_id: 21, purchase_reference: "<PO>", amount: 25 }] })).toContain("&lt;PO&gt;");
  });
});
