import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { ApiError } from "../errors/api-error.js";
import { createRateListBrowserRouter } from "./rate-list.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const list = { id: 5, organization_id: organizationId, name: "Sale Rates", code: "SALE-TEST", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true, created_at: "", updated_at: "" };
const product = { id: 9, organization_id: organizationId, brand_id: 2, name: "Cement", sku: "CEM-9", category: "Cement", unit: "bag", purchase_price: 100, sale_price: 120, created_at: "", updated_at: "" };
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };

function setup() {
  const repo = {
    listRateLists: vi.fn().mockResolvedValue([list]), getRateList: vi.fn().mockResolvedValue(list),
    listVersions: vi.fn().mockResolvedValue([{ id: 11, rate_list_id: 5, version_number: 1, status: "ACTIVE", effective_from: "2026-09-01T00:00:00Z", effective_to: null, created_at: "", updated_at: "" }]),
    listItems: vi.fn().mockResolvedValue([{ id: 12, rate_list_version_id: 11, product_id: 9, minimum_quantity: 1, unit_price: 150, unit: "bag", created_at: "", updated_at: "" }]),
    createRateList: vi.fn().mockResolvedValue(list), createDraftVersion: vi.fn().mockResolvedValue({ version: { id: 13, status: "DRAFT" }, items: [] }),
    publishVersion: vi.fn().mockResolvedValue({ id: 13, status: "ACTIVE" }),
    findBestRateListItem: vi.fn().mockResolvedValue({ rate_list_id: 5, rate_list_version_id: 11, rate_list_item_id: 12, product_id: 9, unit_price: 150, unit: "bag", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-09-01T00:00:00Z" }),
  };
  const references = { getProduct: vi.fn().mockResolvedValue(product), getCustomer: vi.fn().mockResolvedValue({ id: 7 }), getVendor: vi.fn().mockResolvedValue({ id: 8 }) };
  const assertAuthorized = vi.fn().mockResolvedValue(undefined);
  const app = express(); app.use(express.json());
  app.use("/api/v1/rate-lists", createRateListBrowserRouter({
    repository: repo as unknown as NonNullable<Parameters<typeof createRateListBrowserRouter>[0]>["repository"],
    references: references as unknown as NonNullable<Parameters<typeof createRateListBrowserRouter>[0]>["references"],
    tenantAuthorizer: { assertAuthorized },
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; (req as any).log = { warn: vi.fn(), error: vi.fn() }; next(); },
  })); app.use(errorHandler);
  return { app, repo, references, assertAuthorized };
}

describe("Rate List browser route", () => {
  it("lists and opens only organization-owned Rate Lists with product identity", async () => {
    const { app, repo, assertAuthorized } = setup();
    const register = await request(app).get("/api/v1/rate-lists").set(headers);
    const detail = await request(app).get("/api/v1/rate-lists/5").set(headers);
    expect(register.status).toBe(200);
    expect(detail.status).toBe(200);
    expect(detail.body.data.versions[0].items[0].product).toMatchObject({ sku: "CEM-9", brand_id: 2 });
    expect(repo.getRateList).toHaveBeenCalledWith(5, organizationId);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "products.read", { kind: "branch", branchId });
  });

  it("rejects a missing branch authorization and foreign Rate List", async () => {
    const { app, repo, assertAuthorized } = setup();
    assertAuthorized.mockRejectedValueOnce(new ApiError(403, "BRANCH_ACCESS_DENIED", "branch denied"));
    expect((await request(app).get("/api/v1/rate-lists").set(headers)).status).toBe(403);
    expect(repo.listRateLists).not.toHaveBeenCalled();
    repo.getRateList.mockResolvedValueOnce(null);
    expect((await request(app).get("/api/v1/rate-lists/5").set(headers)).status).toBe(404);
  });

  it("creates a list through the authoring service with tenant identity", async () => {
    const { app, repo } = setup();
    const response = await request(app).post("/api/v1/rate-lists").set(headers).set("Origin", "https://muraderp-ai.vercel.app").set("X-Forwarded-Host", "muraderp-ai.vercel.app").set("Sec-Fetch-Site", "same-origin").send({ name: "Sale Rates", code: "SALE-TEST", price_type: "SALE", scope_type: "GLOBAL", currency_code: "PKR" });
    expect(response.status).toBe(201);
    expect(repo.createRateList).toHaveBeenCalledWith(expect.objectContaining({ organization_id: organizationId, code: "SALE-TEST" }));
  });

  it("rejects cross-site requests even when a forwarded host is supplied", async () => {
    const { app, repo } = setup();
    const response = await request(app).post("/api/v1/rate-lists").set(headers).set("Origin", "https://elsewhere.example").set("X-Forwarded-Host", "elsewhere.example").set("Sec-Fetch-Site", "cross-site").send({ name: "Other", code: "OTHER", price_type: "SALE", scope_type: "GLOBAL" });
    expect(response.status).toBe(403);
    expect(repo.createRateList).not.toHaveBeenCalled();
  });

  it("imports a tenant-checked draft with an owned product and rejects invalid rates", async () => {
    const { app, repo } = setup();
    const input = { version_number: 2, effective_from: "2026-09-30", items: [{ product_id: 9, minimum_quantity: 1, unit_price: 155, unit: "bag" }] };
    const response = await request(app).post("/api/v1/rate-lists/5/versions").set(headers).send(input);
    expect(response.status).toBe(201);
    expect(repo.createDraftVersion).toHaveBeenCalledWith(expect.objectContaining({ organization_id: organizationId, rate_list_id: 5, version_number: 2, items: input.items }));
    expect((await request(app).post("/api/v1/rate-lists/5/versions").set(headers).send({ ...input, items: [{ ...input.items[0], unit_price: -1 }] })).status).toBe(400);
    expect(repo.createDraftVersion).toHaveBeenCalledTimes(1);
  });

  it("publishes only a version belonging to this list and resolves the active price", async () => {
    const { app, repo } = setup();
    const bad = await request(app).post("/api/v1/rate-lists/5/versions/99/publish").set(headers).send({});
    expect(bad.status).toBe(404);
    expect(repo.publishVersion).not.toHaveBeenCalled();
    const published = await request(app).post("/api/v1/rate-lists/5/versions/11/publish").set(headers).send({});
    expect(published.status).toBe(200);
    expect(repo.publishVersion).toHaveBeenCalledWith(11, organizationId);
    const price = await request(app).get("/api/v1/rate-lists/5/price?product_id=9&quantity=2&as_of=2026-09-30").set(headers);
    expect(price.status).toBe(200);
    expect(price.body.data).toMatchObject({ product_id: 9, unit_price: 150, rate_list_version_id: 11 });
    expect(repo.findBestRateListItem).toHaveBeenCalledWith(expect.objectContaining({ organization_id: organizationId, product_id: 9, rate_list_id: 5, quantity: 2 }));
  });

  it("maps duplicate code or version conflicts to 409", async () => {
    const { app, repo } = setup();
    repo.createRateList.mockRejectedValueOnce({ code: "23505" });
    const response = await request(app).post("/api/v1/rate-lists").set(headers).send({ name: "Sale Rates", code: "SALE-TEST", price_type: "SALE", scope_type: "GLOBAL" });
    expect(response.status).toBe(409);
  });
});
