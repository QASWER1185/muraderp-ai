import { describe, expect, it, vi } from "vitest";
import { SupabaseSalesTransactionRepository } from "./sales-transaction.repository.js";
import type { SalesTransactionRequest } from "../types/sales-transaction.types.js";

const request: SalesTransactionRequest = {
  invoice: {
    id: 0,
    status: "DRAFT",
    source_estimate_id: null,
    source_type: "DIRECT",
    definition: { invoice_number: "INV-100", customer_id: 7, issue_date: "2026-08-14", currency_code: "PKR" },
    lines: [],
    subtotal: 10000,
    discount_total: 500,
    grand_total: 9500,
    pass_through_rent: 0,
  },
  warehouse_id: 2,
  idempotency_key: "sales-100",
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, line_total: 10000, unit_cost: null, cogs_total: null }],
};

describe("SupabaseSalesTransactionRepository", () => {
  it("calls the atomic database transaction with the configured principal", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 101, error: null });
    const client = { rpc };
    const repository = new SupabaseSalesTransactionRepository("internal-system", () => client as never);

    const result = await repository.execute(request);

    expect(result.invoice.id).toBe(101);
    expect(result.invoice.status).toBe("POSTED");
    expect(rpc).toHaveBeenCalledWith("record_sales_transaction", expect.objectContaining({
      p_principal_id: "internal-system",
      p_idempotency_key: "sales-100",
      p_invoice_number: "INV-100",
      p_customer_id: 7,
      p_warehouse_id: 2,
    }));
    expect(rpc.mock.calls[0]?.[1].p_request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps insufficient stock to a conflict error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0004" } });
    const repository = new SupabaseSalesTransactionRepository("internal-system", () => ({ rpc }) as never);
    await expect(repository.execute(request)).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_STOCK" });
  });
});
