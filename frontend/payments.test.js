import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomerPayment, getCustomerPayment, listCustomerPayments, listReceivables } from "./payment-api.js";
import { paymentDetailMarkup, paymentListMarkup, receivableListMarkup, validateCustomerPaymentDraft } from "./payments.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
const receivable = { invoice_id: 14, invoice_number: "INV-14", customer_id: 19, customer_name: "Customer", currency_code: "PKR", status: "POSTED", invoice_total: 950, paid: 0, credited: 0, outstanding: 950 };
afterEach(() => vi.unstubAllGlobals());

describe("Customer Payment browser integration", () => {
  it("uses same-origin authenticated workspace APIs and an idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listReceivables(context);
    await listCustomerPayments(context, { limit: 25 });
    await getCustomerPayment(context, 4);
    await createCustomerPayment(context, { customer_id: 19 }, "payment-key");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/browser/customer-payments/receivables?limit=100",
      "/api/v1/browser/customer-payments?limit=25",
      "/api/v1/browser/customer-payments/4",
      "/api/v1/browser/customer-payments",
    ]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.credentials).toBe("include");
      expect(options.headers["X-Organization-Id"]).toBe(context.organizationId);
      expect(options.headers["X-Branch-Id"]).toBe(context.branchId);
    }
    expect(fetch.mock.calls[3][1].headers["Idempotency-Key"]).toBe("payment-key");
  });

  it("builds one allocation to the selected authorized invoice and rejects overpayment", () => {
    const input = { invoice_id: "14", payment_date: "2026-09-29", amount: "950", payment_method: "CASH", reference_number: "TEST-PAY-1", notes: "Test" };
    expect(validateCustomerPaymentDraft(input, receivable)).toEqual({
      customer_id: 19, payment_date: "2026-09-29", amount: 950, currency_code: "PKR",
      payment_method: "CASH", reference_number: "TEST-PAY-1", notes: "Test",
      allocations: [{ invoice_id: 14, amount: 950 }],
    });
    expect(() => validateCustomerPaymentDraft({ ...input, amount: "951" }, receivable)).toThrow("exceeds");
    expect(() => validateCustomerPaymentDraft({ ...input, invoice_id: "15" }, receivable)).toThrow("authorized invoice");
    expect(() => validateCustomerPaymentDraft(input, { ...receivable, outstanding: 0 })).toThrow("no outstanding");
  });

  it("escapes names and references in payment and receivable views", () => {
    expect(receivableListMarkup([{ ...receivable, customer_name: "<Customer>" }])).toContain("&lt;Customer&gt;");
    expect(paymentListMarkup([{ id: 4, customer_id: 19, payment_date: "2026-09-29", amount: 950, currency_code: "PKR", payment_method: "CASH", reference_number: "<PAY>" }])).toContain("&lt;PAY&gt;");
    expect(paymentDetailMarkup({ payment: { id: 4, customer_id: 19, payment_date: "2026-09-29", amount: 950, currency_code: "PKR", payment_method: "CASH", reference_number: "<PAY>", notes: null }, allocations: [{ invoice_id: 14, invoice_number: "<INV>", amount: 950 }] })).toContain("&lt;INV&gt;");
  });
});
