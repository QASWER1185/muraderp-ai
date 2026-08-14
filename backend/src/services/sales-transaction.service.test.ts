import { describe, expect, it } from "vitest";
import { SalesTransactionService } from "./sales-transaction.service.js";
import type { SalesTransactionLine, SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";

const requestLine: SalesTransactionLine = {
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
    source_estimate_id: null,
    source_type: "DIRECT",
    definition: { invoice_number: "INV-0001", customer_id: 7, issue_date: "2026-08-13", currency_code: "PKR" },
    lines: [],
    subtotal: 10000,
    discount_total: 500,
    grand_total: 9500,
    pass_through_rent: 1000,
  },
  warehouse_id: 1,
  idempotency_key: "invoice-0001",
  lines: [requestLine],
};

const transaction: SalesTransactionPort = {
  execute: async (value) => ({
    invoice: { ...value.invoice, id: 101, status: "POSTED" },
    inventory_decreased: true,
    customer_receivable_updated: true,
    revenue_recorded: true,
    cogs_recorded: true,
    profit_loss_recorded: true,
    pass_through_rent_recorded: true,
  }),
};

describe("SalesTransactionService", () => {
  it("delegates a valid invoice to the atomic transaction port", async () => {
    const result = await new SalesTransactionService(transaction).createInvoice(request);
    expect(result.invoice.status).toBe("POSTED");
    expect(result.inventory_decreased).toBe(true);
    expect(result.customer_receivable_updated).toBe(true);
    expect(result.revenue_recorded).toBe(true);
    expect(result.cogs_recorded).toBe(true);
    expect(result.profit_loss_recorded).toBe(true);
    expect(result.pass_through_rent_recorded).toBe(true);
  });

  it("rejects duplicate line numbers before any transaction executes", async () => {
    await expect(new SalesTransactionService(transaction).createInvoice({
      ...request,
      lines: [requestLine, { ...requestLine, line_number: 2 }].map((line) => ({ ...line, line_number: 1 })),
    })).rejects.toThrow("duplicate line_number 1");
  });

  it("rejects a mismatched COGS amount before mutation", async () => {
    const mismatchedLine: SalesTransactionLine = { ...requestLine, cogs_total: 7999 };
    await expect(new SalesTransactionService(transaction).createInvoice({
      ...request,
      lines: [mismatchedLine],
    })).rejects.toThrow("cogs_total mismatch on line 1");
  });
});
