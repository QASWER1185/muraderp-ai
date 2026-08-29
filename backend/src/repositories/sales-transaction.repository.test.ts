import { describe, expect, it, vi } from "vitest";
import { SupabaseSalesTransactionRepository } from "./sales-transaction.repository.js";
import type { SalesTransactionRequest } from "../types/sales-transaction.types.js";

const request: SalesTransactionRequest = {
  organization_id: "11111111-1111-4111-8111-111111111111",
  branch_id: null,
  actor_user_id: "22222222-2222-4222-8222-222222222222",
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
  lines: [{ line_number: 1, product_id: 25, quantity: 10, unit: "bag", unit_price: 1000, line_total: 10000, unit_cost: 800, cogs_total: 8000 }],
};

describe("SupabaseSalesTransactionRepository", () => {
  it("calls the P0-8 authoritative atomic database transaction with tenant and principal scope", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { invoice_id: 101, journal_entry_id: "33333333-3333-4333-8333-333333333333", replayed: false, revenue: 9500, cogs: 8000, rent: 0, profit: 1500 },
      error: null,
    });
    const repository = new SupabaseSalesTransactionRepository("sales-api-v1", () => ({ rpc }) as never);
    const result = await repository.execute(request);

    expect(result.invoice.id).toBe(101);
    expect(result.invoice.status).toBe("POSTED");
    expect(rpc).toHaveBeenCalledWith("post_invoice_atomic", expect.objectContaining({
      p_organization_id: request.organization_id,
      p_branch_id: null,
      p_actor_user_id: request.actor_user_id,
      p_service_principal: "sales-api-v1",
      p_operation_scope: "sales.invoice.post",
      p_idempotency_key: "sales-100",
      p_warehouse_id: 2,
    }));
    expect(rpc.mock.calls[0]?.[1].p_request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps insufficient stock to a conflict error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0004" } });
    const repository = new SupabaseSalesTransactionRepository("sales-api-v1", () => ({ rpc }) as never);
    await expect(repository.execute(request)).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
  });

  it("rejects generic service-principal identifiers before the RPC call", async () => {
    const rpc = vi.fn();
    const repository = new SupabaseSalesTransactionRepository("internal-system", () => ({ rpc }) as never);
    await expect(repository.execute(request)).rejects.toMatchObject({ status: 500, code: "ERP_NOT_CONFIGURED" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
