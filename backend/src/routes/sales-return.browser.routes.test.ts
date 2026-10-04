import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createSalesReturnBrowserRouter } from "./sales-return.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
const input = {
  credit_note_number: "CN-TEST-1", invoice_id: 10, customer_id: 7,
  credit_date: "2026-09-28", currency_code: "PKR", reason: "Damaged item", notes: "",
  items: [{ invoice_item_id: 31, warehouse_id: 4, quantity: 1 }],
};

function appFor(options: Parameters<typeof createSalesReturnBrowserRouter>[0] = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/returns", createSalesReturnBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    servicePrincipalId: "muraderp-return-test-01", ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Sales return browser gateway", () => {
  it("reads only the authorized organization and branch", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: 5 }], next_cursor: null });
    const getById = vi.fn().mockResolvedValue({ credit_note: { id: 5 }, items: [] });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ repository: { list, getById }, tenantAuthorizer: { assertAuthorized } });
    const listed = await request(app).get("/api/v1/returns?limit=25&search=CN-5").set(headers);
    const detail = await request(app).get("/api/v1/returns/5").set(headers);
    expect([listed.status, detail.status]).toEqual([200, 200]);
    expect(list).toHaveBeenCalledWith(organizationId, branchId, 25, undefined, "CN-5");
    expect(getById).toHaveBeenCalledWith(organizationId, branchId, 5);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.read", { kind: "branch", branchId });
    expect(listed.headers["cache-control"]).toBe("no-store");
  });

  it("posts through the existing service with branch authorization and authoritative context", async () => {
    const recordSalesReturn = vi.fn().mockResolvedValue({ credit_note: { id: 17 }, items: [] });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { recordSalesReturn }, tenantAuthorizer: { assertAuthorized } });
    const response = await request(app).post("/api/v1/returns").set(headers)
      .set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://muraderp-ai.vercel.app")
      .set("X-Forwarded-Host", "muraderp-ai.vercel.app")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "return-test-1").send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.credit_note.id).toBe(17);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "returns.create", { kind: "branch", branchId });
    expect(recordSalesReturn).toHaveBeenCalledWith(input, expect.objectContaining({
      organizationId, branchId, actorUserId: userId, servicePrincipalId: "muraderp-return-test-01",
      operation: "sales-return.create", idempotencyKey: "return-test-1",
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("rejects cross-origin, permission denial, and missing idempotency before posting", async () => {
    const recordSalesReturn = vi.fn();
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { recordSalesReturn }, tenantAuthorizer: { assertAuthorized } });
    const crossOrigin = await request(app).post("/api/v1/returns").set(headers).set("Origin", "https://other.example").set("Idempotency-Key", "key").send(input);
    const noKey = await request(app).post("/api/v1/returns").set(headers).send(input);
    assertAuthorized.mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied"));
    const denied = await request(app).post("/api/v1/returns").set(headers).set("Idempotency-Key", "key").send(input);
    expect([crossOrigin.status, noKey.status, denied.status]).toEqual([403, 400, 403]);
    expect(recordSalesReturn).not.toHaveBeenCalled();
  });

  it("rejects malformed payload and unauthenticated access", async () => {
    const recordSalesReturn = vi.fn();
    const app = appFor({ service: { recordSalesReturn }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const invalid = await request(app).post("/api/v1/returns").set(headers).set("Idempotency-Key", "key").send({ ...input, items: [] });
    const anonymous = appFor({ authenticate: (_req, res) => { res.status(401).json({ error: { code: "AUTH_REQUIRED" } }); } });
    const noSession = await request(anonymous).get("/api/v1/returns").set(headers);
    expect([invalid.status, noSession.status]).toEqual([400, 401]);
    expect(recordSalesReturn).not.toHaveBeenCalled();
  });
});
