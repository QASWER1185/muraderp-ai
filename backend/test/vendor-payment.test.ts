import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { VendorPaymentService } from "../src/services/vendor-payment.service.js";

const token = "test_internal_token_1234567890abcdef";
const principal = "test-principal";

function stub(overrides: Partial<VendorPaymentService> = {}): VendorPaymentService {
  return { ...overrides } as VendorPaymentService;
}

describe("vendor payments API", () => {
  it("rejects unauthenticated requests", async () => {
    const recordPayment = vi.fn();
    const app = createApp({ vendorPaymentService: stub({ recordPayment }), internalApiToken: token, internalApiPrincipalId: principal });
    const response = await request(app).post("/api/v1/vendor-payments").send({
      vendor_id: 7, payment_date: "2026-08-15", amount: 100, payment_method: "CASH", allocations: [{ purchase_id: 10, amount: 100 }],
    });
    expect(response.status).toBe(401);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("requires an idempotency key", async () => {
    const recordPayment = vi.fn();
    const app = createApp({ vendorPaymentService: stub({ recordPayment }), internalApiToken: token, internalApiPrincipalId: principal });
    const response = await request(app).post("/api/v1/vendor-payments").set("Authorization", `Bearer ${token}`).send({
      vendor_id: 7, payment_date: "2026-08-15", amount: 100, payment_method: "CASH", allocations: [{ purchase_id: 10, amount: 100 }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("rejects allocations that do not equal payment amount", async () => {
    const recordPayment = vi.fn();
    const app = createApp({ vendorPaymentService: stub({ recordPayment }), internalApiToken: token, internalApiPrincipalId: principal });
    const response = await request(app).post("/api/v1/vendor-payments").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "vp-validation-1").send({
      vendor_id: 7, payment_date: "2026-08-15", amount: 100, payment_method: "CASH", allocations: [{ purchase_id: 10, amount: 99 }],
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("passes principal, operation, idempotency key and fingerprint to the service", async () => {
    const recordPayment = vi.fn().mockResolvedValue(901);
    const app = createApp({ vendorPaymentService: stub({ recordPayment }), internalApiToken: token, internalApiPrincipalId: principal });
    const response = await request(app).post("/api/v1/vendor-payments").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "vp-901").send({
      vendor_id: 7, payment_date: "2026-08-15", amount: 150, payment_method: "BANK", reference: " REF-1 ", notes: " test ",
      allocations: [{ purchase_id: 10, amount: 100 }, { purchase_id: 11, amount: 50 }],
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, data: 901 });
    expect(recordPayment).toHaveBeenCalledOnce();
    expect(recordPayment.mock.calls[0]![0]).toEqual({
      vendor_id: 7, payment_date: "2026-08-15", amount: 150, payment_method: "BANK", reference: "REF-1", notes: "test",
      allocations: [{ purchase_id: 10, amount: 100 }, { purchase_id: 11, amount: 50 }],
    });
    expect(recordPayment.mock.calls[0]![1]).toMatchObject({ principalScope: principal, operation: "vendor-payment.create", idempotencyKey: "vp-901" });
    expect(recordPayment.mock.calls[0]![1].requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses a stable fingerprint when allocation order changes", async () => {
    const recordPayment = vi.fn().mockResolvedValue(902);
    const app = createApp({ vendorPaymentService: stub({ recordPayment }), internalApiToken: token, internalApiPrincipalId: principal });
    const first = { vendor_id: 7, payment_date: "2026-08-15", amount: 150, payment_method: "BANK", allocations: [{ purchase_id: 10, amount: 100 }, { purchase_id: 11, amount: 50 }] };
    const second = { ...first, allocations: [{ purchase_id: 11, amount: 50 }, { purchase_id: 10, amount: 100 }] };
    await request(app).post("/api/v1/vendor-payments").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "fp-1").send(first);
    await request(app).post("/api/v1/vendor-payments").set("Authorization", `Bearer ${token}`).set("Idempotency-Key", "fp-2").send(second);
    expect(recordPayment).toHaveBeenCalledTimes(2);
    expect(recordPayment.mock.calls[0]![1].requestFingerprint).toBe(recordPayment.mock.calls[1]![1].requestFingerprint);
  });
});
