import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { EstimateService } from "../services/estimate.service.js";
import type { ErpService } from "../services/erp.service.js";
import { errorHandler } from "../middleware/error-handler.js";
import { createEstimateDraftRouter } from "./estimate-draft.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function browserAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  req.browserPrincipal = { userId };
  (req as unknown as { log: { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void } }).log = { warn: vi.fn(), error: vi.fn() };
  next();
}

function appFor() {
  const createDraft = vi.fn<EstimateService["createDraft"]>().mockResolvedValue({
    id: 91,
    status: "DRAFT",
    definition: { organization_id: organizationId, branch_id: branchId, customer_id: 7, estimate_number: "EST-91", issue_date: "2026-09-14", currency_code: "PKR" },
    lines: [],
    totals: { subtotal: 0, discount_total: 0, grand_total: 0, pass_through_rent: 0, customer_payable_total: 0 },
  });
  const getCustomer = vi.fn<ErpService["getCustomer"]>().mockResolvedValue({ id: 7, organization_id: organizationId, name: "Customer", phone: "0300", city: "Lahore", created_at: "", updated_at: "" });
  const getProduct = vi.fn<ErpService["getProduct"]>().mockResolvedValue({ id: 10, organization_id: organizationId, brand_id: null, name: "Cement", sku: "CEM", category: "Cement", unit: "bag", purchase_price: 1000, sale_price: 1200, created_at: "", updated_at: "" });
  const assertAuthorized = vi.fn().mockResolvedValue(undefined);
  const listActiveSaleRateLists = vi.fn().mockResolvedValue([
    { id: 4, organization_id: organizationId, name: "GM", code: "GM", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true, created_at: "", updated_at: "" },
    { id: 5, organization_id: organizationId, name: "Private", code: "PRIVATE", price_type: "SALE", scope_type: "CUSTOMER", vendor_id: null, customer_id: 99, currency_code: "PKR", is_active: true, created_at: "", updated_at: "" },
  ]);
  const resolvePrice = vi.fn().mockResolvedValue({ rate_list_id: 4, rate_list_version_id: 8, rate_list_item_id: 12, product_id: 10, unit_price: 1275, unit: "bag", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-09-01" });
  const app = express();
  app.use(express.json());
  app.use("/api/v1/estimates", createEstimateDraftRouter({
    authenticate: browserAuth,
    service: { createDraft },
    referenceService: { getCustomer, getProduct },
    tenantAuthorizer: { assertAuthorized },
    rateListRepository: { listActiveSaleRateLists },
    pricingService: { resolvePrice },
  }));
  app.use(errorHandler);
  return { app, createDraft, getCustomer, getProduct, assertAuthorized, listActiveSaleRateLists, resolvePrice };
}

describe("browser-safe estimate draft route", () => {
  it("authorizes, verifies owned references, and calls the existing atomic estimate service", async () => {
    const { app, createDraft, getCustomer, getProduct, assertAuthorized } = appFor();
    const response = await request(app).post("/api/v1/estimates")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).set("Idempotency-Key", "estimate-91")
      .send({ customer_id: 7, estimate_number: "EST-91", issue_date: "2026-09-14", currency_code: "PKR", notes: null, overall_discount: 50, carriage_delivery: 200, default_rate_list_id: 4, lines: [{ product_id: 10, quantity: 2, unit: "bag", unit_price: 1200 }] });

    expect(response.status).toBe(201);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.create", { kind: "branch", branchId });
    expect(getCustomer).toHaveBeenCalledWith(7, organizationId);
    expect(getProduct).toHaveBeenCalledWith(10, organizationId);
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({
      definition: expect.objectContaining({ organization_id: organizationId, branch_id: branchId, layout_key: "MODERN_PAKISTAN", pass_through_rent: 200, default_rate_list_id: 4 }),
      lines: [expect.objectContaining({ product_id: 10, pricing_source: "MANUAL_OVERRIDE", discount_amount: 50, rate_list_id: 4 })],
    }), expect.objectContaining({ actor_user_id: userId, idempotency_key: "estimate-91", source_type: "MANUAL" }));
  });

  it("requires an idempotency key before creating", async () => {
    const { app, createDraft } = appFor();
    const response = await request(app).post("/api/v1/estimates")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId)
      .send({ customer_id: 7, estimate_number: "EST-91", issue_date: "2026-09-14", currency_code: "PKR", lines: [{ product_id: 10, quantity: 2, unit: "bag", unit_price: 1200 }] });
    expect(response.status).toBe(400);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("lists only authorized business-facing rate lists for the estimate customer", async () => {
    const { app } = appFor();
    const response = await request(app).get("/api/v1/estimates/rate-lists?customer_id=7&currency_code=PKR")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([{ id: 4, name: "GM", code: "GM", scope: "GLOBAL" }]);
    expect(JSON.stringify(response.body)).not.toContain(organizationId);
  });

  it("previews rate-only changes while preserving product, quantity, and unit inputs", async () => {
    const { app, resolvePrice } = appFor();
    const response = await request(app).post("/api/v1/estimates/rate-list-preview")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId)
      .send({ customer_id: 7, target_rate_list_id: 4, pricing_date: "2026-09-14", currency_code: "PKR", lines: [{ product_id: 10, quantity: 2, unit: "bag", current_unit_price: 1200 }] });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ matched: 1, needs_review: 0, can_apply: true, rate_list: { name: "GM" } });
    expect(response.body.data.lines[0]).toMatchObject({ product_id: 10, old_rate: 1200, new_rate: 1275, status: "MATCHED" });
    expect(resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ organization_id: organizationId, customer_id: 7, product_id: 10, quantity: 2, rate_list_id: 4 }));
  });

  it("marks missing rates for review and never substitutes another product", async () => {
    const { app, resolvePrice } = appFor();
    resolvePrice.mockResolvedValueOnce(null);
    const response = await request(app).post("/api/v1/estimates/rate-list-preview")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId)
      .send({ customer_id: 7, target_rate_list_id: 4, pricing_date: "2026-09-14", currency_code: "PKR", lines: [{ product_id: 10, quantity: 2, unit: "bag", current_unit_price: 1200 }] });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ matched: 0, needs_review: 1, can_apply: false });
    expect(response.body.data.lines[0]).toMatchObject({ product_id: 10, new_rate: null, status: "UNMATCHED" });
  });

  it("rejects an estimate-level discount above the subtotal", async () => {
    const { app, createDraft } = appFor();
    const response = await request(app).post("/api/v1/estimates")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).set("Idempotency-Key", "estimate-discount")
      .send({ customer_id: 7, estimate_number: "EST-91", issue_date: "2026-09-14", overall_discount: 2500, carriage_delivery: 0, lines: [{ product_id: 10, quantity: 2, unit: "bag", unit_price: 1200 }] });

    expect(response.status).toBe(400);
    expect(createDraft).not.toHaveBeenCalled();
  });
});
