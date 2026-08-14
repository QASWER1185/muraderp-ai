import { describe, expect, it, vi } from "vitest";
import { buildDirectInvoice } from "../src/types/invoice.types.js";
import { SalesTransactionService } from "../src/services/sales-transaction.service.js";
import { SupabaseSalesTransactionAdapter } from "../src/services/supabase-sales-transaction.adapter.js";
import type { SalesTransactionRequest } from "../src/types/sales-transaction.types.js";

const request: SalesTransactionRequest = {
  invoice: buildDirectInvoice(
    {
      invoice_number: "INV-E2E-001",
      customer_id: 7,
      salesperson_id: 3,
      issue_date: "2026-08-14",
      currency_code: "PKR",
      notes: "verification",
    },
    [
      {
        line_number: 1,
        product_id: 10,
        quantity: 2,
        unit: "piece",
        unit_price: 1500,
        pricing_source: "RESOLVED_RATE",
        rate_list_id: 4,
        rate_list_selection_source: "MANUAL_OVERRIDE",
      },
    ],
    3000,
    0,
    3000,
    200,
  ),
  warehouse_id: 2,
  lines: [
    {
      line_number: 1,
      product_id: 10,
      quantity: 2,
      unit: "piece",
      unit_price: 1500,
      line_total: 3000,
      unit_cost: 900,
      cogs_total: 1800,
    },
  ],
  idempotency_key: "invoice-e2e-001",
};

describe("Sales transaction integration contract", () => {
  it("rejects an invalid request before any database adapter call", async () => {
    const execute = vi.fn();
    const service = new SalesTransactionService({ execute });
    const invalid = { ...request, idempotency_key: "   " };

    await expect(service.createInvoice(invalid)).rejects.toThrow("idempotency_key is required");
    expect(execute).not.toHaveBeenCalled();
  });

  it("maps one authoritative invoice transaction to the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        invoice_id: 101,
        replayed: false,
        revenue: 3000,
        cogs: 1800,
        rent: 200,
        profit: 1200,
      },
      error: null,
    });
    const client = { rpc };
    const adapter = new SupabaseSalesTransactionAdapter(() => client as never, "principal-e2e");

    const result = await adapter.execute(request);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(
      "post_invoice_atomic",
      expect.objectContaining({
        p_warehouse_id: 2,
        p_principal_id: "principal-e2e",
        p_idempotency_key: "invoice-e2e-001",
        p_lines: request.lines,
      }),
    );
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

  it("surfaces atomic RPC failure without fabricating a successful transaction", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "insufficient inventory" },
    });
    const adapter = new SupabaseSalesTransactionAdapter(() => ({ rpc }) as never);

    await expect(adapter.execute(request)).rejects.toThrow("Invoice transaction failed: insufficient inventory");
  });

  it("returns the replay result without changing the authoritative result contract", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        invoice_id: 101,
        replayed: true,
        revenue: 0,
        cogs: 0,
        rent: 0,
        profit: 0,
      },
      error: null,
    });
    const adapter = new SupabaseSalesTransactionAdapter(() => ({ rpc }) as never);

    const result = await adapter.execute(request);

    expect(result.invoice.id).toBe(101);
    expect(result.invoice.status).toBe("POSTED");
    expect(result.inventory_decreased).toBe(true);
    expect(result.customer_receivable_updated).toBe(true);
  });
});
