import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createReportsBrowserRouter } from "./reports.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const period = "from=2026-09-01&to=2026-09-30";

function setup(allowed = true) {
  const gateway = {
    getFinancialSummary: vi.fn().mockResolvedValue({ totalDebits: "10.0000", totalCredits: "10.0000" }),
    getDashboardSummary: vi.fn(),
    getDashboardDetail: vi.fn().mockResolvedValue({ key: "profit", label: "Profit", value: "2.0000" }),
    getTrialBalance: vi.fn().mockResolvedValue([{ code: "1000", total_debit: "10.0000" }]),
  };
  const operations = { read: vi.fn().mockResolvedValue({ sales: { daily: [] } }) };
  const assertAuthorized = vi.fn().mockImplementation(() => allowed ? Promise.resolve() : Promise.reject(new Error("DENIED")));
  const hasPermission = vi.fn().mockResolvedValue(allowed);
  const app = express();
  app.use("/api/v1/browser/reports", createReportsBrowserRouter({
    gatewayFactory: () => gateway, operationsFactory: () => operations,
    tenantAuthorizer: { assertAuthorized }, permissionGateway: { hasPermission },
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
  }));
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error instanceof ZodError ? 400 : error.status ?? 403).json({ error: error.message }));
  return { app, gateway, operations, assertAuthorized, hasPermission };
}

const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };

describe("Reports browser routes", () => {
  it("returns labels only on initial load and requires branch-scoped reports.view", async () => {
    const { app, gateway, assertAuthorized, hasPermission } = setup();
    const response = await request(app).get("/api/v1/browser/reports/overview").set(headers);
    expect(response.status).toBe(200);
    expect(response.body.data.heads).toHaveLength(6);
    expect(response.body.data).not.toHaveProperty("totalDebits");
    expect(gateway.getFinancialSummary).not.toHaveBeenCalled();
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "reports.view", { kind: "branch", branchId });
    expect(hasPermission).toHaveBeenCalledWith(userId, organizationId, "reports.view");
  });

  it("returns summary, head detail, and trial balance for an explicit period", async () => {
    const { app, gateway } = setup();
    expect((await request(app).get(`/api/v1/browser/reports/summary?${period}`).set(headers)).body.data.totalDebits).toBe("10.0000");
    expect((await request(app).get(`/api/v1/browser/reports/details?head=profit&${period}`).set(headers)).body.data.value).toBe("2.0000");
    expect((await request(app).get(`/api/v1/browser/reports/trial-balance?${period}`).set(headers)).body.data).toHaveLength(1);
    expect(gateway.getFinancialSummary).toHaveBeenCalledWith(organizationId, { from: "2026-09-01", to: "2026-09-30" });
    expect(gateway.getTrialBalance).toHaveBeenCalledWith(organizationId, { from: "2026-09-01", to: "2026-09-30" });
  });

  it("rejects other origins, invalid periods, and denied access before querying", async () => {
    const { app, gateway } = setup(false);
    expect((await request(app).get(`/api/v1/browser/reports/summary?${period}`).set(headers)).status).toBe(403);
    expect((await request(app).get(`/api/v1/browser/reports/summary?${period}`).set(headers).set("Origin", "https://foreign.example")).status).toBe(403);
    expect(gateway.getFinancialSummary).not.toHaveBeenCalled();
    const valid = setup();
    expect((await request(valid.app).get("/api/v1/browser/reports/summary?from=2026-09-30&to=2026-09-01").set(headers)).status).toBe(400);
    expect(valid.gateway.getFinancialSummary).not.toHaveBeenCalled();
  });
});

it("authorizes operations before reads and rejects invalid bounds and product identifiers", async () => {
 const { app, operations } = setup();
 const url = "/api/v1/browser/reports/operations?" + period;
 expect((await request(app).get(url + "&productId=231").set(headers)).status).toBe(200);
 expect(operations.read).toHaveBeenCalledWith(organizationId, {from:"2026-09-01",to:"2026-09-30"},231);
 operations.read.mockClear();
 for(const query of ["from=2026-09-30&to=2026-09-01", "from=2020-01-01&to=2026-01-01", period + "&productId=-1"]){
  expect((await request(app).get("/api/v1/browser/reports/operations?"+query).set(headers)).status).toBeGreaterThanOrEqual(400);
 }
 expect(operations.read).not.toHaveBeenCalled();
 const denied=setup(false);
 expect((await request(denied.app).get(url).set(headers)).status).toBe(403);
 expect(denied.operations.read).not.toHaveBeenCalled();
});
