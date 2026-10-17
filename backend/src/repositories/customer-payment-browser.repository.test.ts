import { describe, expect, it, vi } from "vitest";
import { SupabaseCustomerPaymentBrowserRepository } from "./customer-payment-browser.repository.js";

describe("Customer Payment browser reads", () => {
  it("calculates invoice outstanding from scoped allocations and posted credits", async () => {
    const filters: Array<{ table: string; name: string; value: unknown }> = [];
    const rows: Record<string, unknown> = {
      invoices: [{ id: 14, invoice_number: "INV-14", customer_id: 19, status: "PARTIALLY_PAID", currency_code: "PKR", grand_total: 950, pass_through_rent: 0 }],
      customers: [{ id: 19, name: "QASWER HUSSAIN SB" }],
      customer_payment_allocations: [{ invoice_id: 14, amount: 200 }],
      credit_notes: [{ invoice_id: 14, grand_total: 50 }],
    };
    const from = vi.fn((table: string) => {
      const chain: any = {
        select: () => chain,
        eq: (name: string, value: unknown) => { filters.push({ table, name, value }); return chain; },
        in: (name: string, value: unknown) => { filters.push({ table, name, value }); return chain; },
        order: () => chain, limit: () => chain, lt: () => chain,
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows[table], error: null }),
      };
      return chain;
    });
    const repository = new SupabaseCustomerPaymentBrowserRepository(() => ({ from }) as any);
    const organizationId = "11111111-1111-4111-8111-111111111111";
    const branchId = "22222222-2222-4222-8222-222222222222";
    const result = await repository.listReceivables(organizationId, branchId, 25);
    expect(result.data).toEqual([{
      invoice_id: 14, invoice_number: "INV-14", customer_id: 19, customer_name: "QASWER HUSSAIN SB",
      status: "PARTIALLY_PAID", currency_code: "PKR", invoice_total: 950,
      paid: 200, credited: 50, outstanding: 700,
    }]);
    for (const table of ["invoices", "customer_payment_allocations", "credit_notes"]) {
      expect(filters).toContainEqual({ table, name: "organization_id", value: organizationId });
      expect(filters).toContainEqual({ table, name: "branch_id", value: branchId });
    }
    expect(filters).toContainEqual({ table: "credit_notes", name: "status", value: "POSTED" });
  });
});
