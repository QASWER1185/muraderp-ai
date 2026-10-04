import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { AccountingBrowserRepository } from "../repositories/accounting-browser.repository.js";
import { createAccountingBrowserRouter } from "./accounting.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const entryId = "44444444-4444-4444-8444-444444444444";
const accountId = "55555555-5555-4555-8555-555555555555";

function makeApp(allowed = true) {
  const repository: AccountingBrowserRepository = {
    listAccounts: vi.fn().mockResolvedValue([{ id: accountId, code: "1000", name: "Cash" }]),
    listEntries: vi.fn().mockResolvedValue({ data: [{ id: entryId, source_type: "INVOICE" }], next_offset: null }),
    getEntry: vi.fn().mockResolvedValue({ id: entryId, lines: [{ debit: 10, credit: 0 }] }),
    listLedger: vi.fn().mockResolvedValue({ account: { id: accountId }, data: [{ debit: 10, credit: 0 }], next_offset: null }),
  };
  const assertAuthorized = vi.fn().mockImplementation(() => allowed ? Promise.resolve() : Promise.reject(new Error("DENIED")));
  const app = express();
  app.use("/api/v1/browser/accounting", createAccountingBrowserRouter({
    repository,
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    tenantAuthorizer: { assertAuthorized },
  }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(403).json({ error: error.message }));
  return { app, repository, assertAuthorized };
}

const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };

describe("Accounting browser read routes", () => {
  it("requires accounting permission and branch access before returning journals", async () => {
    const { app, repository, assertAuthorized } = makeApp();
    const response = await request(app).get("/api/v1/browser/accounting/entries?limit=20&offset=0").set(headers);
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "accounting.read", { kind: "branch", branchId });
    expect(repository.listEntries).toHaveBeenCalledWith({ userId, organizationId, branchId }, 20, 0);
  });

  it("exposes accounts, journal lines, and scoped account ledger through GET only", async () => {
    const { app, repository } = makeApp();
    expect((await request(app).get("/api/v1/browser/accounting/accounts").set(headers)).status).toBe(200);
    expect((await request(app).get(`/api/v1/browser/accounting/entries/${entryId}`).set(headers)).body.data.lines).toHaveLength(1);
    expect((await request(app).get(`/api/v1/browser/accounting/accounts/${accountId}/ledger`).set(headers)).body.data).toHaveLength(1);
    expect(repository.getEntry).toHaveBeenCalledWith({ userId, organizationId, branchId }, entryId);
    expect(repository.listLedger).toHaveBeenCalledWith({ userId, organizationId, branchId }, accountId, 50, 0);
    expect((await request(app).post("/api/v1/browser/accounting/entries").set(headers)).status).toBe(404);
  });

  it("rejects cross-origin and unauthorized requests before data access", async () => {
    const { app, repository } = makeApp(false);
    expect((await request(app).get("/api/v1/browser/accounting/accounts").set(headers)).status).toBe(403);
    expect((await request(app).get("/api/v1/browser/accounting/accounts").set(headers).set("Origin", "https://foreign.example")).status).toBe(403);
    expect(repository.listAccounts).not.toHaveBeenCalled();
  });
});
