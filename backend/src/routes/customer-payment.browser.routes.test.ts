import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createCustomerPaymentBrowserRouter, type CustomerPaymentBrowserOptions } from "./customer-payment.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
const payment = {
  customer_id: 19, payment_date: "2026-09-29", amount: 950, currency_code: "PKR",
  payment_method: "CASH", reference_number: "TEST-VERIFY-CP-20260929-01",
  allocations: [{ invoice_id: 14, amount: 950 }],
};

function repository() {
  return {
    listReceivables: vi.fn().mockResolvedValue({ data: [{ invoice_id: 14, outstanding: 950 }], next_cursor: null }),
    allocationInvoices: vi.fn().mockResolvedValue([{ id: 14, customer_id: 19, currency_code: "PKR" }]),
    listPayments: vi.fn().mockResolvedValue({ data: [{ id: 4 }], next_cursor: null }),
    getPayment: vi.fn().mockResolvedValue({ payment: { id: 4 }, allocations: [{ invoice_id: 14 }] }),
  };
}

function appFor(options: CustomerPaymentBrowserOptions) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/browser/customer-payments", createCustomerPaymentBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    servicePrincipalId: "muraderp-payment-test-01", ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Customer Payment browser gateway", () => {
  it("reads receivables, payment register, and allocation detail only in the authorized branch", async () => {
    const repo = repository();
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ repository: repo, tenantAuthorizer: { assertAuthorized } });
    const receivables = await request(app).get("/api/v1/browser/customer-payments/receivables?limit=25").set(headers);
    const payments = await request(app).get("/api/v1/browser/customer-payments?limit=25").set(headers);
    const detail = await request(app).get("/api/v1/browser/customer-payments/4").set(headers);
    expect([receivables.status, payments.status, detail.status]).toEqual([200, 200, 200]);
    expect(repo.listReceivables).toHaveBeenCalledWith(organizationId, branchId, 25, undefined);
    expect(repo.listPayments).toHaveBeenCalledWith(organizationId, branchId, 25, undefined);
    expect(repo.getPayment).toHaveBeenCalledWith(organizationId, branchId, 4);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "payments.create", { kind: "branch", branchId });
    expect(detail.headers["cache-control"]).toBe("no-store");
  });

  it("posts through the existing authoritative payment service with proxy-aware origin and idempotency", async () => {
    const repo = repository();
    const recordPayment = vi.fn().mockResolvedValue({ payment: { id: 4 }, allocations: [{ invoice_id: 14, amount: 950 }] });
    const app = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/browser/customer-payments")
      .set(headers).set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://muraderp-ai.vercel.app")
      .set("X-Forwarded-Host", "muraderp-ai.vercel.app")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "payment-test-key").send(payment);
    expect(response.status).toBe(201);
    expect(repo.allocationInvoices).toHaveBeenCalledWith(organizationId, branchId, [14]);
    expect(recordPayment).toHaveBeenCalledWith(payment, expect.objectContaining({
      organizationId, branchId, actorUserId: userId, servicePrincipalId: "muraderp-payment-test-01",
      operation: "customer-payment.create", idempotencyKey: "payment-test-key",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("rejects cross-site, missing idempotency, invalid totals, and wrong customer or currency before posting", async () => {
    const repo = repository();
    const recordPayment = vi.fn();
    const app = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const post = () => request(app).post("/api/v1/browser/customer-payments").set(headers).set("Idempotency-Key", "key");
    const crossSite = await post().set("Origin", "https://elsewhere.example").set("X-Forwarded-Host", "elsewhere.example").set("Sec-Fetch-Site", "cross-site").send(payment);
    const noKey = await request(app).post("/api/v1/browser/customer-payments").set(headers).send(payment);
    const invalidTotal = await post().send({ ...payment, amount: 951 });
    repo.allocationInvoices.mockResolvedValueOnce([{ id: 14, customer_id: 20, currency_code: "PKR" }]);
    const wrongCustomer = await post().send(payment);
    repo.allocationInvoices.mockResolvedValueOnce([{ id: 14, customer_id: 19, currency_code: "USD" }]);
    const wrongCurrency = await post().send(payment);
    expect([crossSite.status, noKey.status, invalidTotal.status, wrongCustomer.status, wrongCurrency.status]).toEqual([403, 400, 400, 403, 400]);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("requires tenant permission and an authenticated browser session", async () => {
    const repo = repository();
    const recordPayment = vi.fn();
    const denied = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied")) } });
    expect((await request(denied).post("/api/v1/browser/customer-payments").set(headers).set("Idempotency-Key", "key").send(payment)).status).toBe(403);
    const unauthenticated = appFor({ repository: repo, service: { recordPayment }, authenticate: (_req, res) => { res.status(401).end(); } });
    expect((await request(unauthenticated).get("/api/v1/browser/customer-payments").set(headers)).status).toBe(401);
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
