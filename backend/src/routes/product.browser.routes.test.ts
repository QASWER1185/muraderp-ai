import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ErpService } from "../services/erp.service.js";
import { createProductRouter } from "./product.routes.js";
import express from "express";
import { ApiError } from "../errors/api-error.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function browserAuth(request: express.Request, _response: express.Response, next: express.NextFunction) {
  request.browserPrincipal = { userId };
  next();
}

function appFor(service: Partial<ErpService>, assertAuthorized = vi.fn().mockResolvedValue(undefined)) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/products", createProductRouter({
    service: service as Pick<ErpService, "listProducts" | "getProduct" | "createProduct" | "updateProduct">,
    tenantAuthorizer: { assertAuthorized },
    authenticate: browserAuth,
  }));
  return { app, assertAuthorized };
}

describe("browser-safe Product routes", () => {
  it("passes partial search through the organization-scoped service", async () => {
    const listProducts = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const { app, assertAuthorized } = appFor({ listProducts });

    const response = await request(app)
      .get("/api/v1/products?search=GM%20Cable&limit=25")
      .set("X-Organization-Id", organizationId)
      .set("X-Branch-Id", branchId);

    expect(response.status).toBe(200);
    expect(listProducts).toHaveBeenCalledWith({ search: "GM Cable", limit: 25 }, organizationId);
    expect(assertAuthorized).toHaveBeenCalledWith(
      { userId, organizationId },
      "products.read",
      { kind: "branch", branchId },
    );
  });

  it("fails closed without organization and branch context", async () => {
    const listProducts = vi.fn();
    const { app } = appFor({ listProducts });
    const response = await request(app).get("/api/v1/products?search=pipe");
    expect(response.status).toBe(500);
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("returns only the requested organization product detail", async () => {
    const getProduct = vi.fn().mockResolvedValue({ id: 7, name: "Popular Pipe" });
    const { app } = appFor({ getProduct });
    const response = await request(app)
      .get("/api/v1/products/7")
      .set("X-Organization-Id", organizationId)
      .set("X-Branch-Id", branchId);
    expect(response.status).toBe(200);
    expect(getProduct).toHaveBeenCalledWith(7, organizationId);
  });

  it("creates only after products.write authorization for the selected branch", async () => {
    const createProduct = vi.fn().mockImplementation(async (input) => ({ id: 8, ...input }));
    const { app, assertAuthorized } = appFor({ createProduct });
    const draft = { name: "Test Pipe", sku: "TEST-PIPE", category: "Pipe", unit: "pcs", purchase_price: 5, sale_price: 10, brand_id: null };
    const response = await request(app).post("/api/v1/products")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).send(draft);
    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(8);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "products.write", { kind: "branch", branchId });
    expect(createProduct).toHaveBeenCalledWith(draft, organizationId);
  });

  it("edits through the organization-scoped authoritative service", async () => {
    const updateProduct = vi.fn().mockResolvedValue({ id: 8, name: "Updated Pipe" });
    const { app, assertAuthorized } = appFor({ updateProduct });
    const response = await request(app).patch("/api/v1/products/8")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).send({ name: " Updated Pipe " });
    expect(response.status).toBe(200);
    expect(updateProduct).toHaveBeenCalledWith(8, { name: "Updated Pipe" }, organizationId);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "products.write", { kind: "branch", branchId });
  });

  it("does not write when branch authorization is denied", async () => {
    const createProduct = vi.fn();
    const updateProduct = vi.fn();
    const deny = vi.fn().mockRejectedValue(new ApiError(403, "FORBIDDEN", "Denied"));
    const { app } = appFor({ createProduct, updateProduct }, deny);
    const create = await request(app).post("/api/v1/products")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).send({ name: "Pipe" });
    const edit = await request(app).patch("/api/v1/products/8")
      .set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId).send({ name: "Pipe" });
    expect(create.status).toBe(403);
    expect(edit.status).toBe(403);
    expect(createProduct).not.toHaveBeenCalled();
    expect(updateProduct).not.toHaveBeenCalled();
  });
});
