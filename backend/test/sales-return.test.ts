import { describe, expect, it, vi } from "vitest";
import { SupabaseSalesReturnService } from "../src/services/sales-return.service.js";

const input = {
  credit_note_number: "CN-1001",
  invoice_id: 10,
  customer_id: 20,
  credit_date: "2026-08-14",
  currency_code: "PKR",
  reason: "Damaged item",
  notes: "Approved return",
  items: [{ invoice_item_id: 30, warehouse_id: 2, quantity: 1 }],
};

describe("SupabaseSalesReturnService", () => {
  it("calls the atomic database transaction with the complete context", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { credit_note: { id: 7 }, items: [] }, error: null });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    const result = await service.recordSalesReturn(input, {
      principalScope: "principal-1",
      operation: "sales-return.create",
      idempotencyKey: "key-1",
      requestFingerprint: "fingerprint-1",
    });

    expect(result).toEqual({ credit_note: { id: 7 }, items: [] });
    expect(rpc).toHaveBeenCalledWith("record_sales_return", expect.objectContaining({
      p_credit_note_number: "CN-1001",
      p_invoice_id: 10,
      p_customer_id: 20,
      p_items: input.items,
      p_principal_scope: "principal-1",
      p_operation: "sales-return.create",
      p_idempotency_key: "key-1",
      p_request_fingerprint: "fingerprint-1",
    }));
  });

  it("maps over-return database errors to a conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0002", message: "too much" } });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    await expect(service.recordSalesReturn(input, {
      principalScope: "principal-1",
      operation: "sales-return.create",
      idempotencyKey: "key-1",
      requestFingerprint: "fingerprint-1",
    })).rejects.toMatchObject({ statusCode: 409, code: "RETURN_QUANTITY_EXCEEDED" });
  });

  it("maps idempotency fingerprint conflicts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "different request" } });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    await expect(service.recordSalesReturn(input, {
      principalScope: "principal-1",
      operation: "sales-return.create",
      idempotencyKey: "key-1",
      requestFingerprint: "fingerprint-2",
    })).rejects.toMatchObject({ statusCode: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });
});
