import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createPurchaseBrowserRouter } from "./purchase.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
const input = {
  vendor_id: 7, warehouse_id: 4, purchase_date: "2026-09-28", invoice_number: " SUP-501 ",
  items: [{ product_id: 31, quantity: 2, unit_cost: 100 }], discount: 5, tax: 10, notes: "Supplier bill",
};

function appFor(options: Parameters<typeof createPurchaseBrowserRouter>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/browser/purchases", createPurchaseBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    servicePrincipalId: "muraderp-purchase-test-01", ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Purchase browser gateway", () => {
  it("reads purchases only for the authorized organization and branch", async () => {
    const listPurchases = vi.fn().mockResolvedValue({ data: [{ id: 5 }], next_cursor: null });
    const getPurchase = vi.fn().mockResolvedValue({ purchase: { id: 5 }, items: [] });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { listPurchases, getPurchase, recordPurchase: vi.fn() }, tenantAuthorizer: { assertAuthorized } });
    const listed = await request(app).get("/api/v1/browser/purchases?limit=25").set(headers);
    const detail = await request(app).get("/api/v1/browser/purchases/5").set(headers);
    expect([listed.status, detail.status]).toEqual([200, 200]);
    expect(listPurchases).toHaveBeenCalledWith({ limit: 25 }, organizationId, branchId);
    expect(getPurchase).toHaveBeenCalledWith(5, organizationId, branchId);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "purchases.read", { kind: "branch", branchId });
    expect(listed.headers["cache-control"]).toBe("no-store");
  });

  it("posts through the existing purchase service with authorized context and idempotency", async () => {
    const recordPurchase = vi.fn().mockResolvedValue({ purchase: { id: 17 }, items: [] });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { listPurchases: vi.fn(), getPurchase: vi.fn(), recordPurchase }, tenantAuthorizer: { assertAuthorized } });
    const response = await request(app).post("/api/v1/browser/purchases").set(headers).set("Idempotency-Key", "purchase-test-1").send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.purchase.id).toBe(17);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "purchases.create", { kind: "branch", branchId });
    expect(recordPurchase).toHaveBeenCalledWith(expect.objectContaining({ invoice_number: "sup-501", items: input.items }), expect.objectContaining({
      organizationId, branchId, actorUserId: userId, servicePrincipalId: "muraderp-purchase-test-01",
      operation: "purchase.create", idempotencyKey: "purchase-test-1",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("accepts a same-origin purchase post forwarded through the production proxy", async () => {
    const recordPurchase = vi.fn().mockResolvedValue({ purchase: { id: 18 }, items: [] });
    const app = appFor({ service: { listPurchases: vi.fn(), getPurchase: vi.fn(), recordPurchase }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/browser/purchases")
      .set(headers)
      .set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://muraderp-ai.vercel.app")
      .set("X-Forwarded-Host", "muraderp-ai.vercel.app")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "proxied-purchase")
      .send(input);
    expect(response.status).toBe(201);
    expect(recordPurchase).toHaveBeenCalledOnce();
  });

  it("rejects a cross-site purchase post even when its forwarded host matches", async () => {
    const recordPurchase = vi.fn();
    const app = appFor({ service: { listPurchases: vi.fn(), getPurchase: vi.fn(), recordPurchase }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/browser/purchases")
      .set(headers)
      .set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://elsewhere.example")
      .set("X-Forwarded-Host", "elsewhere.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Idempotency-Key", "cross-site-purchase")
      .send(input);
    expect(response.status).toBe(403);
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("rejects cross-origin, denied, and incomplete purchase posts before the service", async () => {
    const recordPurchase = vi.fn();
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { listPurchases: vi.fn(), getPurchase: vi.fn(), recordPurchase }, tenantAuthorizer: { assertAuthorized } });
    const crossOrigin = await request(app).post("/api/v1/browser/purchases").set(headers).set("Origin", "https://other.example").set("Idempotency-Key", "key").send(input);
    const noKey = await request(app).post("/api/v1/browser/purchases").set(headers).send(input);
    const invalid = await request(app).post("/api/v1/browser/purchases").set(headers).set("Idempotency-Key", "key").send({ ...input, items: [] });
    assertAuthorized.mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied"));
    const denied = await request(app).post("/api/v1/browser/purchases").set(headers).set("Idempotency-Key", "key").send(input);
    expect([crossOrigin.status, noKey.status, invalid.status, denied.status]).toEqual([403, 400, 400, 403]);
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("requires a browser session", async () => {
    const app = appFor({ authenticate: (_req, res) => { res.status(401).json({ error: { code: "AUTH_REQUIRED" } }); } });
    expect((await request(app).get("/api/v1/browser/purchases").set(headers)).status).toBe(401);
  });
});
