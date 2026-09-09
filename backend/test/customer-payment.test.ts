import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  SupabaseCustomerPaymentService,
  type CustomerPaymentInput,
  type CustomerPaymentResult,
  type CustomerPaymentService,
} from "../src/services/customer-payment.service.js";

const internalToken = "test_internal_token_1234567890abcdef";
const principalId = "test-principal";
const transactionHeaders = {
  "X-Organization-Id": "11111111-1111-4111-8111-111111111111",
  "X-Branch-Id": "22222222-2222-4222-8222-222222222222",
  "X-Actor-User-Id": "33333333-3333-4333-8333-333333333333",
};

function serviceStub(overrides: Partial<CustomerPaymentService> = {}): CustomerPaymentService {
  return { ...overrides } as CustomerPaymentService;
}

const payment: CustomerPaymentResult = {
  payment: {
    id: 701,
    customer_id: 11,
    payment_date: "2026-08-14",
    amount: 100,
    currency_code: "PKR",
    payment_method: "CASH",
    reference_number: "RCPT-701",
    notes: "test receipt",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
  },
  allocations: [
    { id: 801, payment_id: 701, invoice_id: 501, amount: 100, created_at: "2026-08-14T00:00:00.000Z" },
  ],
};

describe("customer payments API", () => {
  it("rejects an unauthenticated payment request", async () => {
    const recordPayment = vi.fn();
    const app = createApp({
      customerPaymentService: serviceStub({ recordPayment }),
      internalApiToken: internalToken,
      internalApiPrincipalId: principalId,
    });

    const response = await request(app)
      .post("/api/v1/customer-payments")
      .send({ customer_id: 11, payment_date: "2026-08-14", amount: 100, currency_code: "PKR", payment_method: "CASH", allocations: [{ invoice_id: 501, amount: 100 }] });

    expect(response.status).toBe(401);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("requires Idempotency-Key before payment persistence", async () => {
    const recordPayment = vi.fn();
    const app = createApp({ customerPaymentService: serviceStub({ recordPayment }), internalApiToken: internalToken, internalApiPrincipalId: principalId });

    const response = await request(app)
      .post("/api/v1/customer-payments")
      .set("Authorization", `Bearer ${internalToken}`)
      .set(transactionHeaders)
      .send({ customer_id: 11, payment_date: "2026-08-14", amount: 100, currency_code: "PKR", payment_method: "CASH", allocations: [{ invoice_id: 501, amount: 100 }] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("rejects allocation totals that do not equal the payment amount", async () => {
    const recordPayment = vi.fn();
    const app = createApp({ customerPaymentService: serviceStub({ recordPayment }), internalApiToken: internalToken, internalApiPrincipalId: principalId });

    const response = await request(app)
      .post("/api/v1/customer-payments")
      .set("Authorization", `Bearer ${internalToken}`)
      .set(transactionHeaders)
      .set("Idempotency-Key", "payment-validation-701")
      .send({ customer_id: 11, payment_date: "2026-08-14", amount: 100, currency_code: "PKR", payment_method: "CASH", allocations: [{ invoice_id: 501, amount: 99 }] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("passes principal, idempotency key, normalized input, and fingerprint to the transaction service", async () => {
    const recordPayment = vi.fn().mockResolvedValue(payment);
    const app = createApp({ customerPaymentService: serviceStub({ recordPayment }), internalApiToken: internalToken, internalApiPrincipalId: principalId });

    const response = await request(app)
      .post("/api/v1/customer-payments")
      .set("Authorization", `Bearer ${internalToken}`)
      .set(transactionHeaders)
      .set("Idempotency-Key", "payment-key-701")
      .send({
        customer_id: 11,
        payment_date: "2026-08-14",
        amount: 100,
        currency_code: "pkr",
        payment_method: "CASH",
        reference_number: " RCPT-701 ",
        notes: " test receipt ",
        allocations: [{ invoice_id: 501, amount: 100 }],
      });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(payment);
    expect(recordPayment).toHaveBeenCalledOnce();
    expect(recordPayment.mock.calls[0]![0]).toEqual({
      customer_id: 11,
      payment_date: "2026-08-14",
      amount: 100,
      currency_code: "PKR",
      payment_method: "CASH",
      reference_number: "RCPT-701",
      notes: "test receipt",
      allocations: [{ invoice_id: 501, amount: 100 }],
    });
    expect(recordPayment.mock.calls[0]![1]).toMatchObject({
      organizationId: transactionHeaders["X-Organization-Id"],
      branchId: transactionHeaders["X-Branch-Id"],
      actorUserId: transactionHeaders["X-Actor-User-Id"],
      servicePrincipalId: principalId,
      operation: "customer-payment.create",
      idempotencyKey: "payment-key-701",
    });
    expect(recordPayment.mock.calls[0]![1].requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces the same fingerprint when allocation order changes", async () => {
    const recordPayment = vi.fn().mockResolvedValue(payment);
    const app = createApp({ customerPaymentService: serviceStub({ recordPayment }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const base = {
      customer_id: 11,
      payment_date: "2026-08-14",
      amount: 150,
      currency_code: "PKR",
      payment_method: "BANK_TRANSFER" as const,
      allocations: [{ invoice_id: 501, amount: 100 }, { invoice_id: 502, amount: 50 }],
    };

    await request(app).post("/api/v1/customer-payments").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "fingerprint-1").send(base);
    await request(app).post("/api/v1/customer-payments").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "fingerprint-2").send({ ...base, allocations: [{ invoice_id: 502, amount: 50 }, { invoice_id: 501, amount: 100 }] });

    expect(recordPayment).toHaveBeenCalledTimes(2);
    expect(recordPayment.mock.calls[0]![1].requestFingerprint).toBe(recordPayment.mock.calls[1]![1].requestFingerprint);
  });

  it("maps an in-progress database request to the idempotency conflict contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0003", message: "busy" } });
    const service = new SupabaseCustomerPaymentService(() => ({ rpc } as never));
    const input: CustomerPaymentInput = {
      customer_id: 11,
      payment_date: "2026-08-14",
      amount: 100,
      currency_code: "PKR",
      payment_method: "CASH",
      allocations: [{ invoice_id: 501, amount: 100 }],
    };

    await expect(service.recordPayment(input, {
      organizationId: transactionHeaders["X-Organization-Id"],
      branchId: transactionHeaders["X-Branch-Id"],
      actorUserId: transactionHeaders["X-Actor-User-Id"],
      servicePrincipalId: principalId,
      operation: "customer-payment.create",
      idempotencyKey: "in-progress",
      requestFingerprint: "a".repeat(64),
    })).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_REQUEST_IN_PROGRESS" });
  });
});
