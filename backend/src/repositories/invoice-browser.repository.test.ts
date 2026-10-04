import { describe, expect, it, vi } from "vitest";
import { SupabaseInvoiceBrowserRepository } from "./invoice-browser.repository.js";

describe("Invoice browser reads", () => {
  it("filters list and detail by both central-workspace identifiers before reading lines", async () => {
    const calls: Array<[string, unknown]> = [];
    const query = (data: unknown) => {
      const chain: any = {
        select: () => chain,
        eq: (name: string, value: unknown) => { calls.push([name, value]); return chain; },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data, error: null }),
      };
      return chain;
    };
    let invoiceQueries = 0;
    const from = vi.fn((table: string) => {
      if (table === "invoice_items") return query([{ id: 31, invoice_id: 12 }]);
      if (table === "estimates") return query([{ id: 41, estimate_number: "EST-41" }]);
      invoiceQueries += 1;
      return query(invoiceQueries === 1 ? [{ id: 12 }] : { id: 12 });
    });
    const repository = new SupabaseInvoiceBrowserRepository(() => ({ from }) as any);
    const organization = "11111111-1111-4111-8111-111111111111";
    const branch = "22222222-2222-4222-8222-222222222222";
    await repository.list(organization, branch, 25);
    const detail = await repository.getById(organization, branch, 12);
    const ready = await repository.listReadyEstimates(organization, branch);
    expect(detail?.lines).toHaveLength(1);
    expect(ready[0]?.id).toBe(41);
    expect(calls.filter(([name]) => name === "organization_id")).toEqual(Array.from({ length: 3 }, () => ["organization_id", organization]));
    expect(calls.filter(([name]) => name === "branch_id")).toEqual(Array.from({ length: 3 }, () => ["branch_id", branch]));
    expect(calls).toContainEqual(["status", "READY"]);
    expect(from.mock.calls.map(([table]) => table)).toEqual(["invoices", "invoices", "invoice_items", "estimates"]);
  });
});
