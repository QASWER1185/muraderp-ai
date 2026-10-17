import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createVendorPaymentBrowserRouter, type VendorPaymentBrowserOptions } from "./vendor-payment.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
const payment = {
  vendor_id: 9, payment_date: "2026-09-29", amount: 25,
  payment_method: "CASH", reference: "TEST-VERIFY-VP-20260929-01",
  allocations: [{ purchase_id: 21, amount: 25 }],
};

function repository() {
  return {
    listPayables: vi.fn().mockResolvedValue({ data: [{ purchase_id: 21, outstanding: 750 }], next_cursor: null }),
    allocationPurchases: vi.fn().mockResolvedValue([{ id: 21, vendor_id: 9 }]),
    listPayments: vi.fn().mockResolvedValue({ data: [{ id: 4 }], next_cursor: null }),
    getPayment: vi.fn().mockResolvedValue({ payment: { id: 4 }, allocations: [{ purchase_id: 21 }] }),
  };
}

function appFor(options: VendorPaymentBrowserOptions) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/browser/vendor-payments", createVendorPaymentBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    servicePrincipalId: "muraderp-payment-test-01", ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Vendor Payment browser gateway", () => {
  it("reads payable, register, and detail only for the authorized branch", async () => {
    const repo = repository();
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ repository: repo, tenantAuthorizer: { assertAuthorized } });
    const payables = await request(app).get("/api/v1/browser/vendor-payments/payables?limit=25").set(headers);
    const payments = await request(app).get("/api/v1/browser/vendor-payments?limit=25").set(headers);
    const detail = await request(app).get("/api/v1/browser/vendor-payments/4").set(headers);
    expect([payables.status, payments.status, detail.status]).toEqual([200, 200, 200]);
    expect(repo.listPayables).toHaveBeenCalledWith(organizationId, branchId, 25, undefined);
    expect(repo.listPayments).toHaveBeenCalledWith(organizationId, branchId, 25, undefined);
    expect(repo.getPayment).toHaveBeenCalledWith(organizationId, branchId, 4);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "payments.create", { kind: "branch", branchId });
    expect(detail.headers["cache-control"]).toBe("no-store");
  });

  it("posts through the authoritative service with session identity, allocation, and idempotency", async () => {
    const repo = repository();
    const recordPayment = vi.fn().mockResolvedValue(4);
    const app = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/browser/vendor-payments")
      .set(headers).set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://muraderp-ai.vercel.app")
      .set("X-Forwarded-Host", "muraderp-ai.vercel.app")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "vendor-payment-test-key").send(payment);
    expect(response.status).toBe(201);
    expect(response.body.data.payment_id).toBe(4);
    expect(repo.allocationPurchases).toHaveBeenCalledWith(organizationId, branchId, [21]);
    expect(recordPayment).toHaveBeenCalledWith(payment, expect.objectContaining({
      organizationId, branchId, actorUserId: userId, servicePrincipalId: "muraderp-payment-test-01",
      operation: "vendor-payment.create", idempotencyKey: "vendor-payment-test-key",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("rejects unauthenticated, unauthorized, cross-site, invalid, or wrong-vendor requests before posting", async () => {
    const repo = repository();
    const recordPayment = vi.fn();
    const allowed = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const post = () => request(allowed).post("/api/v1/browser/vendor-payments").set(headers).set("Idempotency-Key", "key");
    const crossSite = await post().set("Origin", "https://elsewhere.example").set("Sec-Fetch-Site", "cross-site").send(payment);
    const noKey = await request(allowed).post("/api/v1/browser/vendor-payments").set(headers).send(payment);
    const invalidTotal = await post().send({ ...payment, amount: 26 });
    repo.allocationPurchases.mockResolvedValueOnce([{ id: 21, vendor_id: 10 }]);
    const wrongVendor = await post().send(payment);
    const denied = appFor({ repository: repo, service: { recordPayment }, tenantAuthorizer: { assertAuthorized: vi.fn().mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied")) } });
    const deniedResponse = await request(denied).post("/api/v1/browser/vendor-payments").set(headers).set("Idempotency-Key", "key").send(payment);
    const unauthenticated = appFor({ repository: repo, service: { recordPayment }, authenticate: (_req, res) => { res.status(401).end(); } });
    const unauthenticatedResponse = await request(unauthenticated).get("/api/v1/browser/vendor-payments").set(headers);
    expect([crossSite.status, noKey.status, invalidTotal.status, wrongVendor.status, deniedResponse.status, unauthenticatedResponse.status]).toEqual([403, 400, 400, 403, 403, 401]);
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
