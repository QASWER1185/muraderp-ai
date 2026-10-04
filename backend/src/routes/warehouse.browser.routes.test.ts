import express from "express";
import request from "supertest";
import { pinoHttp } from "pino-http";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../errors/api-error.js";
import { errorHandler } from "../middleware/error-handler.js";
import type { ErpService } from "../services/erp.service.js";
import { createWarehouseBrowserRouter } from "./warehouse.browser.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const headers = { "X-Organization-Id": organizationId, "X-Branch-Id": branchId };
function setup(service: Partial<ErpService>, assertAuthorized = vi.fn().mockResolvedValue(undefined)) {
  const app = express(); app.use(pinoHttp({ enabled: false })); app.use(express.json());
  app.use("/api/v1/warehouses", createWarehouseBrowserRouter({
    service: service as Pick<ErpService, "listWarehouses" | "getWarehouse" | "createWarehouse" | "updateWarehouse">,
    tenantAuthorizer: { assertAuthorized },
    authenticate: (req, _res, next) => { req.browserPrincipal = { userId }; next(); },
  }));
  app.use(errorHandler);
  return { app, assertAuthorized };
}

describe("browser Warehouse route", () => {
  it("lists and reads only after branch authorization", async () => {
    const listWarehouses = vi.fn().mockResolvedValue({ data: [{ id: 4, name: "Main" }], next_cursor: null });
    const getWarehouse = vi.fn().mockResolvedValue({ id: 4, name: "Main" });
    const { app, assertAuthorized } = setup({ listWarehouses, getWarehouse });
    const list = await request(app).get("/api/v1/warehouses?limit=25").set(headers);
    const detail = await request(app).get("/api/v1/warehouses/4").set(headers);
    expect(list.status).toBe(200); expect(detail.status).toBe(200);
    expect(listWarehouses).toHaveBeenCalledWith({ limit: 25 }, organizationId);
    expect(getWarehouse).toHaveBeenCalledWith(4, organizationId);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "inventory.read", { kind: "branch", branchId });
  });
  it("creates and edits through the existing warehouse service", async () => {
    const createWarehouse = vi.fn().mockResolvedValue({ id: 5, name: "West", location: null });
    const updateWarehouse = vi.fn().mockResolvedValue({ id: 5, name: "West", location: "Lahore" });
    const { app, assertAuthorized } = setup({ createWarehouse, updateWarehouse });
    const created = await request(app).post("/api/v1/warehouses").set(headers).send({ name: " West ", location: null });
    const updated = await request(app).patch("/api/v1/warehouses/5").set(headers).send({ location: " Lahore " });
    expect(created.status).toBe(201); expect(updated.status).toBe(200);
    expect(createWarehouse).toHaveBeenCalledWith({ name: "West", location: null }, organizationId);
    expect(updateWarehouse).toHaveBeenCalledWith(5, { location: "Lahore" }, organizationId);
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "inventory.adjust", { kind: "branch", branchId });
  });
  it("rejects denied access and actor spoofing before service calls", async () => {
    const createWarehouse = vi.fn();
    const deny = vi.fn().mockRejectedValue(new ApiError(403, "PERMISSION_DENIED", "Denied"));
    const { app } = setup({ createWarehouse }, deny);
    const denied = await request(app).post("/api/v1/warehouses").set(headers).send({ name: "West" });
    const spoofed = await request(app).post("/api/v1/warehouses").set(headers).set("X-Actor-User-Id", organizationId).send({ name: "West" });
    expect(denied.status).toBe(403); expect(spoofed.status).toBe(403);
    expect(createWarehouse).not.toHaveBeenCalled();
  });
});
