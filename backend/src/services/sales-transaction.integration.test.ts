import { describe, expect, it, vi } from "vitest";
import { SalesTransactionService } from "./sales-transaction.service.js";
import type { SalesTransactionLine, SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";

const line: SalesTransactionLine = {
  line_number: 1,
  product_id: 25,
  quantity: 10,
  unit: "bag",
  unit_price: 1000,
  line_total: 10000,
  unit_cost: 800,
  cogs_total: 8000,
};

const request: SalesTransactionRequest = {
  invoice: {
    id: 0,
    status: "DRAFT",
    source_estimate_id: 42,
    source_type: "FROM_ESTIMATE",
    definition: {
      invoice_number: "INV-TEST-0001",
      customer_id: 7,
      issue_date: "2026-08-13",
      currency_code: "PKR",
    },
    lines: [],
    subtotal: 10000,
    discount_total: 500,
    grand_total: 9500,
    pass_through_rent: 750,
  },
  warehouse_id: 1,
  idempotency_key: "invoice-test-0001",
  lines: [line],
};

function successfulPort(): SalesTransactionPort {
  return {
    execute: vi.fn(async (value) => ({
      invoice: { ...value.invoice, id: 501, status: "POSTED" },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: true,
      cogs_recorded: true,
      profit_loss_recorded: true,
      pass_through_rent_recorded: true,
    })),
  };
}

describe("Invoice transaction integration contract", () => {
  it("requires every authoritative accounting/stock outcome to be reported", async () => {
    const port = successfulPort();
    const result = await new SalesTransactionService(port).createInvoice(request);

    expect(result.invoice.id).toBe(501);
    expect(result.invoice.status).toBe("POSTED");
    expect(result.inventory_decreased).toBe(true);
    expect(result.customer_receivable_updated).toBe(true);
    expect(result.revenue_recorded).toBe(true);
    expect(result.cogs_recorded).toBe(true);
    expect(result.profit_loss_recorded).toBe(true);
    expect(result.pass_through_rent_recorded).toBe(true);
    expect(port.execute).toHaveBeenCalledTimes(1);
  });

  it("passes the estimate source through to the authoritative transaction port", async () => {
    const port = successfulPort();
    await new SalesTransactionService(port).createInvoice(request);

    expect(port.execute).toHaveBeenCalledWith(expect.objectContaining({
      invoice: expect.objectContaining({
        source_estimate_id: 42,
        source_type: "FROM_ESTIMATE",
      }),
    }));
  });

  it("does not call the transaction port when request validation fails", async () => {
    const port = successfulPort();
    await expect(new SalesTransactionService(port).createInvoice({
      ...request,
      idempotency_key: "",
    })).rejects.toThrow("idempotency_key is required");

    expect(port.execute).not.toHaveBeenCalled();
  });

  it("rejects an existing invoice id before any database mutation", async () => {
    const port = successfulPort();
    await expect(new SalesTransactionService(port).createInvoice({
      ...request,
      invoice: { ...request.invoice, id: 501 },
    })).rejects.toThrow("new sales transaction must not reuse an existing invoice id");

    expect(port.execute).not.toHaveBeenCalled();
  });

  it("rejects a non-positive warehouse before any database mutation", async () => {
    const port = successfulPort();
    await expect(new SalesTransactionService(port).createInvoice({
      ...request,
      warehouse_id: 0,
    })).rejects.toThrow("warehouse_id must be a positive integer");

    expect(port.execute).not.toHaveBeenCalled();
  });
});
