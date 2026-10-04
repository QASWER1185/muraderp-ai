import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInvoiceBrowserRouter } from "./invoice.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
const input = {
  invoice_number: "INV-TEST-1", customer_id: 7, warehouse_id: 4,
  issue_date: "2026-09-28", currency_code: "PKR", discount_total: 5,
  pass_through_rent: 0, lines: [{ product_id: 9, quantity: 2, unit: "bag", unit_price: 100, unit_cost: 70 }],
};

function appFor(options: Parameters<typeof createInvoiceBrowserRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/invoices", createInvoiceBrowserRouter({
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
    servicePrincipalId: "muraderp-invoice-test-01", ...options,
  }));
  app.use((error: ApiError | ZodError, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ error: { code: error instanceof ZodError ? "VALIDATION_ERROR" : error.code } });
  });
  return app;
}

describe("Invoice browser gateway", () => {
  it("reads only the selected organization and branch after sales.read authorization", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: 1 }], next_cursor: null });
    const getById = vi.fn().mockResolvedValue({ invoice: { id: 1 }, lines: [] });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ repository: { list, getById, listReadyEstimates: vi.fn().mockResolvedValue([]) }, tenantAuthorizer: { assertAuthorized } });
    const listed = await request(app).get("/api/v1/invoices?limit=25").set(headers);
    const detail = await request(app).get("/api/v1/invoices/1").set(headers);
    expect([listed.status, detail.status]).toEqual([200, 200]);
    expect(list).toHaveBeenCalledWith(organizationId, branchId, 25, undefined);
    expect(getById).toHaveBeenCalledWith(organizationId, branchId, 1);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.read", { kind: "branch", branchId });
  });

  it("posts only after sales.create authorization and computes authoritative request totals on the server", async () => {
    const execute = vi.fn(async (value) => ({ invoice: { ...value.invoice, id: 18, status: "POSTED" as const }, inventory_decreased: true, customer_receivable_updated: true, revenue_recorded: true, cogs_recorded: true, profit_loss_recorded: true, pass_through_rent_recorded: false }));
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized } });
    const response = await request(app).post("/api/v1/invoices").set(headers).set("Idempotency-Key", "invoice-test-1").send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.invoice.id).toBe(18);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.create", { kind: "branch", branchId });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: organizationId, branch_id: branchId, actor_user_id: userId, warehouse_id: 4,
      invoice: expect.objectContaining({ subtotal: 200, discount_total: 5, grand_total: 195 }),
      lines: [expect.objectContaining({ line_total: 200, unit_cost: 70, cogs_total: 140 })],
    }));
  });

  it("accepts a same-origin browser post forwarded through the production proxy", async () => {
    const execute = vi.fn(async (value) => ({
      invoice: { ...value.invoice, id: 21, status: "POSTED" as const },
      inventory_decreased: true, customer_receivable_updated: true, revenue_recorded: true,
      cogs_recorded: true, profit_loss_recorded: true, pass_through_rent_recorded: false,
    }));
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/invoices")
      .set(headers)
      .set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://muraderp-ai.vercel.app")
      .set("X-Forwarded-Host", "muraderp-ai.vercel.app")
      .set("Sec-Fetch-Site", "same-origin")
      .set("Idempotency-Key", "proxied-invoice")
      .send(input);
    expect(response.status).toBe(201);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("sends exact decimal line and invoice totals to the strict numeric posting boundary", async () => {
    const execute = vi.fn(async (value) => ({ invoice: { ...value.invoice, id: 20, status: "POSTED" as const }, inventory_decreased: true, customer_receivable_updated: true, revenue_recorded: true, cogs_recorded: true, profit_loss_recorded: true, pass_through_rent_recorded: false }));
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/invoices").set(headers).set("Idempotency-Key", "fractional-invoice").send({ ...input, discount_total: 0.01, lines: [
      { product_id: 9, quantity: 0.1, unit: "bag", unit_price: 0.3, unit_cost: 0.2 },
      { product_id: 10, quantity: 0.1, unit: "bag", unit_price: 0.3, unit_cost: 0.2 },
    ] });
    expect(response.status).toBe(201);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      invoice: expect.objectContaining({ subtotal: 0.06, discount_total: 0.01, grand_total: 0.05 }),
      lines: [expect.objectContaining({ line_total: 0.03, cogs_total: 0.02 }), expect.objectContaining({ line_total: 0.03, cogs_total: 0.02 })],
    }));
  });

  it("rejects unauthorized or cross-origin browser posting before the transaction", async () => {
    const execute = vi.fn();
    const deny = vi.fn().mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied"));
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized: deny } });
    const denied = await request(app).post("/api/v1/invoices").set(headers).set("Idempotency-Key", "key").send(input);
    const crossOrigin = await request(app).post("/api/v1/invoices").set(headers).set("Origin", "https://elsewhere.example").set("Idempotency-Key", "key").send(input);
    expect([denied.status, crossOrigin.status]).toEqual([403, 403]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a cross-site post even when the forwarded host matches its origin", async () => {
    const execute = vi.fn();
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/invoices")
      .set(headers)
      .set("Host", "muraderp-api-jy6eophhla-el.a.run.app")
      .set("Origin", "https://elsewhere.example")
      .set("X-Forwarded-Host", "elsewhere.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("Idempotency-Key", "cross-site-invoice")
      .send(input);
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires explicit cost and idempotency before posting", async () => {
    const execute = vi.fn();
    const app = appFor({ transaction: { execute }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const noCost = await request(app).post("/api/v1/invoices").set(headers).set("Idempotency-Key", "key").send({ ...input, lines: [{ product_id: 9, quantity: 2, unit: "bag", unit_price: 100 }] });
    const noKey = await request(app).post("/api/v1/invoices").set(headers).send(input);
    expect(noCost.status).toBe(400);
    expect(noKey.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("converts only a READY estimate in the selected branch using its persisted lines", async () => {
    const source = { record: { id: 41, branch_id: branchId, status: "READY", customer_id: 7, currency_code: "PKR", notes: null, pass_through_rent: 2 }, items: [{ line_number: 1, product_id: 9, quantity: 2, unit: "bag", unit_price: 100, discount_amount: 5, pricing_source: "MANUAL_OVERRIDE" }] };
    const execute = vi.fn(async (value) => ({ invoice: { ...value.invoice, id: 19, status: "POSTED" as const }, inventory_decreased: true, customer_receivable_updated: true, revenue_recorded: true, cogs_recorded: true, profit_loss_recorded: true, pass_through_rent_recorded: true }));
    const getEstimateAggregate = vi.fn().mockResolvedValue(source);
    const app = appFor({ transaction: { execute }, estimateReader: { getEstimateAggregate }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).post("/api/v1/invoices/from-estimate").set(headers).set("Idempotency-Key", "estimate-41-invoice").send({ source_estimate_id: 41, invoice_number: "INV-41", issue_date: "2026-09-28", warehouse_id: 4, unit_costs: [{ line_number: 1, unit_cost: 70 }] });
    expect(response.status).toBe(201);
    expect(getEstimateAggregate).toHaveBeenCalledWith(41, organizationId);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ invoice: expect.objectContaining({ source_type: "FROM_ESTIMATE", source_estimate_id: 41, subtotal: 200, discount_total: 5, grand_total: 195 }), lines: [expect.objectContaining({ unit_cost: 70, cogs_total: 140 })] }));
    getEstimateAggregate.mockResolvedValue({ ...source, record: { ...source.record, branch_id: organizationId } });
    const wrongBranch = await request(app).post("/api/v1/invoices/from-estimate").set(headers).set("Idempotency-Key", "estimate-41-other").send({ source_estimate_id: 41, invoice_number: "INV-42", issue_date: "2026-09-28", warehouse_id: 4, unit_costs: [{ line_number: 1, unit_cost: 70 }] });
    expect(wrongBranch.status).toBe(404);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("lists ready estimates through the browser route before the invoice id route", async () => {
    const listReadyEstimates = vi.fn().mockResolvedValue([{ id: 41, estimate_number: "EST-41" }]);
    const getById = vi.fn();
    const app = appFor({ repository: { list: vi.fn(), getById, listReadyEstimates }, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } });
    const response = await request(app).get("/api/v1/invoices/ready-estimates").set(headers);
    expect(response.status).toBe(200);
    expect(response.body.data[0].id).toBe(41);
    expect(listReadyEstimates).toHaveBeenCalledWith(organizationId, branchId);
    expect(getById).not.toHaveBeenCalled();
  });
});
