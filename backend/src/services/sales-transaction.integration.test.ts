import { describe, expect, it, vi } from "vitest";
import { buildDirectInvoice } from "../types/invoice.types.js";
import { SalesTransactionService } from "./sales-transaction.service.js";
import { SupabaseSalesTransactionAdapter } from "./supabase-sales-transaction.adapter.js";
import type { SalesTransactionRequest } from "../types/sales-transaction.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorUserId = "22222222-2222-4222-8222-222222222222";
const request: SalesTransactionRequest = {
  organization_id: organizationId,
  branch_id: null,
  actor_user_id: actorUserId,
  invoice: buildDirectInvoice(
    { invoice_number: "INV-E2E-001", customer_id: 7, salesperson_id: 3, issue_date: "2026-08-14", currency_code: "PKR", notes: "verification" },
    [{ line_number: 1, product_id: 10, quantity: 2, unit: "piece", unit_price: 1500, pricing_source: "RESOLVED_RATE", rate_list_id: 4, rate_list_selection_source: "MANUAL_OVERRIDE" }],
    3000,
    0,
    3000,
    200,
  ),
  warehouse_id: 2,
  lines: [{ line_number: 1, product_id: 10, quantity: 2, unit: "piece", unit_price: 1500, line_total: 3000, unit_cost: 900, cogs_total: 1800 }],
  idempotency_key: "invoice-e2e-001",
};

const principalId = "principal-e2e";

describe("Sales transaction P0-8 integration contract", () => {
  it("rejects an invalid request before any database adapter call", async () => {
    const execute = vi.fn();
    const service = new SalesTransactionService({ execute });
    const invalid = { ...request, idempotency_key: "   " };
    await expect(service.createInvoice(invalid)).rejects.toThrow("idempotency_key is required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps the selected sales transaction to the organization-aware authoritative RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { invoice_id: 101, journal_entry_id: "33333333-3333-4333-8333-333333333333", replayed: false, revenue: 3000, cogs: 1800, rent: 200, profit: 1200 }, error: null });
    const adapter = new SupabaseSalesTransactionAdapter(() => ({ rpc }) as never, principalId);
    const result = await new SalesTransactionService(adapter).createInvoice(request);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("post_invoice_atomic", expect.objectContaining({
      p_organization_id: organizationId,
      p_branch_id: null,
      p_actor_user_id: actorUserId,
      p_service_principal: principalId,
      p_operation_scope: "sales.invoice.post",
      p_warehouse_id: 2,
      p_idempotency_key: "invoice-e2e-001",
      p_lines: request.lines,
      p_invoice: expect.objectContaining({ grand_total: 3000, pass_through_rent: 200 }),
    }));
    expect(result).toMatchObject({
      invoice: { id: 101, status: "POSTED" },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: true,
      cogs_recorded: true,
      profit_loss_recorded: true,
      pass_through_rent_recorded: true,
    });
  });

  it("surfaces idempotency fingerprint conflicts as a conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "idempotency key was already used for a different sales request" } });
    const adapter = new SupabaseSalesTransactionAdapter(() => ({ rpc }) as never, principalId);
    await expect(adapter.execute(request)).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("surfaces insufficient stock atomically", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0004", message: "insufficient stock" } });
    const adapter = new SupabaseSalesTransactionAdapter(() => ({ rpc }) as never, principalId);
    await expect(adapter.execute(request)).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });
  });
});
