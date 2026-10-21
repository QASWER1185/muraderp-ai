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

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
  actorUserId: "33333333-3333-4333-8333-333333333333",
  servicePrincipalId: "principal-1",
  operation: "sales-return.create" as const,
  idempotencyKey: "key-1",
  requestFingerprint: "a".repeat(64),
};

describe("SupabaseSalesReturnService", () => {
  it("calls the atomic database transaction with the complete context", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { credit_note: { id: 7 }, items: [] }, error: null });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    const result = await service.recordSalesReturn(input, context);

    expect(result).toEqual({ credit_note: { id: 7 }, items: [] });
    expect(rpc).toHaveBeenCalledWith("record_sales_return", expect.objectContaining({
      p_credit_note_number: "CN-1001",
      p_invoice_id: 10,
      p_customer_id: 20,
      p_items: input.items,
      p_organization_id: context.organizationId,
      p_branch_id: context.branchId,
      p_actor_user_id: context.actorUserId,
      p_service_principal: context.servicePrincipalId,
      p_operation_scope: "sales-return.create",
      p_idempotency_key: "key-1",
      p_request_fingerprint: context.requestFingerprint,
    }));
  });

  it("maps over-return database errors to a conflict", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0002", message: "too much" } });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    await expect(service.recordSalesReturn(input, context)).rejects.toMatchObject({ status: 409, code: "RETURN_QUANTITY_EXCEEDED" });
  });

  it("maps idempotency fingerprint conflicts", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "different request" } });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    await expect(service.recordSalesReturn(input, { ...context, requestFingerprint: "b".repeat(64) }))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("maps an in-progress database request to the idempotency conflict contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0003", message: "busy" } });
    const service = new SupabaseSalesReturnService(() => ({ rpc } as never));

    await expect(service.recordSalesReturn(input, context))
      .rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" });
  });
});
