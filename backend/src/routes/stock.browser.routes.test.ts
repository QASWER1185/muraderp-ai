import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createStockBrowserRouter } from "./stock.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };

function appFor(options: Parameters<typeof createStockBrowserRouter>[0] = {}) {
  const app = express();
  app.use("/api/v1/browser/stock", createStockBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); }, ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Stock browser gateway", () => {
  it("reads balances by organization and movements by organization and branch after permission checks", async () => {
    const listInventory = vi.fn().mockResolvedValue({ data: [{ id: 7, quantity: 2 }], next_cursor: null });
    const listStockMovements = vi.fn().mockResolvedValue({ data: [{ id: 9, reference_type: "PURCHASE" }], next_cursor: null });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { listInventory, listStockMovements }, tenantAuthorizer: { assertAuthorized } });
    const balances = await request(app).get("/api/v1/browser/stock/balances?limit=25&warehouse_id=4").set(headers);
    const movements = await request(app).get("/api/v1/browser/stock/movements?limit=10&product_id=31").set(headers);
    expect([balances.status, movements.status]).toEqual([200, 200]);
    expect(listInventory).toHaveBeenCalledWith({ limit: 25, warehouse_id: 4 }, organizationId);
    expect(listStockMovements).toHaveBeenCalledWith({ limit: 10, product_id: 31 }, organizationId, branchId);
    expect(assertAuthorized).toHaveBeenCalledTimes(2);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "inventory.read", { kind: "branch", branchId });
    expect(balances.headers["cache-control"]).toBe("no-store");
  });

  it("rejects cross-site, invalid scope, and denied reads before accessing stock", async () => {
    const listInventory = vi.fn();
    const listStockMovements = vi.fn();
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ service: { listInventory, listStockMovements }, tenantAuthorizer: { assertAuthorized } });
    const crossSite = await request(app).get("/api/v1/browser/stock/balances").set(headers).set("Sec-Fetch-Site", "cross-site");
    const invalid = await request(app).get("/api/v1/browser/stock/movements?product_id=0").set(headers);
    assertAuthorized.mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied"));
    const denied = await request(app).get("/api/v1/browser/stock/balances").set(headers);
    expect([crossSite.status, invalid.status, denied.status]).toEqual([403, 400, 403]);
    expect(listInventory).not.toHaveBeenCalled();
    expect(listStockMovements).not.toHaveBeenCalled();
  });

  it("requires an authenticated browser session", async () => {
    const app = appFor({ authenticate: (_req, res) => { res.status(401).json({ error: { code: "AUTH_REQUIRED" } }); } });
    expect((await request(app).get("/api/v1/browser/stock/balances").set(headers)).status).toBe(401);
  });
});
