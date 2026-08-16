import { describe, expect, it, vi } from "vitest";
import { SupabaseErpService } from "../src/services/erp.service.js";

const purchase = {
  id: 701,
  vendor_id: 3,
  warehouse_id: 2,
  purchase_date: "2026-08-16",
  invoice_number: "stage4-701",
  subtotal: 10,
  discount: 0,
  tax: 0,
  total: 10,
  notes: "stage4",
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

const items = [
  {
    id: 702,
    purchase_id: 701,
    product_id: 2,
    quantity: 1,
    unit_cost: 10,
    total_cost: 10,
    created_at: "2026-08-16T00:00:00.000Z",
    updated_at: "2026-08-16T00:00:00.000Z",
  },
];

const idempotency = {
  principalScope: "stage4-principal",
  operation: "purchase.create" as const,
  idempotencyKey: "stage4-key",
  requestFingerprint: "a".repeat(64),
};

describe("Phase 23 Stage 4 — idempotency service contract", () => {
  it("reconstructs a replayed purchase from the authoritative database response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        replayed: true,
        response_status: 201,
        response_body: { data: { purchase, items } },
      },
      error: null,
    });

    const service = new SupabaseErpService(() => ({ rpc }) as never);
    const result = await service.recordPurchase(
      {
        vendor_id: 3,
        warehouse_id: 2,
        items: [{ product_id: 2, quantity: 1, unit_cost: 10 }],
        purchase_date: "2026-08-16",
        invoice_number: "stage4-701",
      },
      idempotency,
    );

    expect(result).toEqual({ purchase, items });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_purchase", expect.objectContaining({
      p_idempotency_principal: idempotency.principalScope,
      p_idempotency_operation: idempotency.operation,
      p_idempotency_key: idempotency.idempotencyKey,
      p_request_fingerprint: idempotency.requestFingerprint,
    }));
  });

  it("maps database idempotency-key reuse to a deterministic 409 API error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0001",
        message: "Idempotency-Key was already used for a different purchase request",
        details: null,
        hint: null,
      },
    });

    const service = new SupabaseErpService(() => ({ rpc }) as never);

    await expect(
      service.recordPurchase(
        {
          vendor_id: 3,
          warehouse_id: 2,
          items: [{ product_id: 2, quantity: 1, unit_cost: 10 }],
        },
        idempotency,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("maps in-progress idempotency conflicts to a deterministic 409 API error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "P0003",
        message: "The Idempotency-Key is currently being processed",
        details: null,
        hint: null,
      },
    });

    const service = new SupabaseErpService(() => ({ rpc }) as never);

    await expect(
      service.recordPurchase(
        {
          vendor_id: 3,
          warehouse_id: 2,
          items: [{ product_id: 2, quantity: 1, unit_cost: 10 }],
        },
        idempotency,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
    });
  });
});
