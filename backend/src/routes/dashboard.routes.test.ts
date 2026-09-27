import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ErpService } from "../services/erp.service.js";
import { createDashboardRouter } from "./dashboard.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function browserAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  req.browserPrincipal = { userId };
  next();
}

describe("browser-safe dashboard stock route", () => {
  it("rejects cross-site browser requests before loading stock", async () => {
    const listInventory = vi.fn<ErpService["listInventory"]>();
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({
      service: { listInventory, listStockMovements: vi.fn(), getProduct: vi.fn() },
      authenticate: browserAuth,
      tenantAuthorizer: { assertAuthorized: vi.fn() },
    }));
    const response = await request(app).get("/api/v1/dashboard/stock")
      .set("Origin", "https://untrusted.example")
      .set("Sec-Fetch-Site", "cross-site")
      .set("X-Organization-Id", organizationId)
      .set("X-Branch-Id", branchId);

    expect(response.status).toBe(403);
    expect(listInventory).not.toHaveBeenCalled();
  });

  it("returns organization stock with product labels and recent branch activity", async () => {
    const listInventory = vi.fn<ErpService["listInventory"]>().mockResolvedValue({ data: [
      { id: 1, organization_id: organizationId, product_id: 10, warehouse_id: 2, quantity: 4, created_at: "", updated_at: "" },
      { id: 2, organization_id: organizationId, product_id: 10, warehouse_id: 3, quantity: 6, created_at: "", updated_at: "" },
    ], next_cursor: null });
    const listStockMovements = vi.fn<ErpService["listStockMovements"]>().mockResolvedValue({ data: [
      { id: 5, organization_id: organizationId, branch_id: branchId, product_id: 10, warehouse_id: 2, movement_type: "PURCHASE", quantity: 4, unit_cost: 1000, reference_id: null, reference_type: null, notes: null, created_at: "2026-09-14T10:00:00Z" },
    ], next_cursor: null });
    const getProduct = vi.fn<ErpService["getProduct"]>().mockResolvedValue({ id: 10, organization_id: organizationId, brand_id: null, name: "Cement Bag", sku: "CEM", category: "Cement", unit: "bag", purchase_price: 1000, sale_price: 1200, created_at: "", updated_at: "" });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({ service: { listInventory, listStockMovements, getProduct }, authenticate: browserAuth, tenantAuthorizer: { assertAuthorized } }));
    const response = await request(app).get("/api/v1/dashboard/stock").set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);

    expect(response.status).toBe(200);
    expect(response.body.data.inventory_items[0]).toEqual(expect.objectContaining({ product_name: "Cement Bag", current_stock: 10, unit: "bag", rate: 1200 }));
    expect(response.body.data.recent_activity[0]).toEqual(expect.objectContaining({ product_name: "Cement Bag", movement_type: "PURCHASE" }));
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "inventory.read", { kind: "branch", branchId });
  });
});
