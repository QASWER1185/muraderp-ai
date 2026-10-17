import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { ErpService } from "../services/erp.service.js";
import { ApiError } from "../errors/api-error.js";
import { createDashboardRouter } from "./dashboard.routes.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

function browserAuth(req: express.Request, _res: express.Response, next: express.NextFunction) {
  req.browserPrincipal = { userId };
  next();
}

describe("browser-safe dashboard stock route", () => {
  it("returns organization stock with product labels and recent branch activity", async () => {
    const listStockMovements = vi.fn<ErpService["listStockMovements"]>().mockResolvedValue({ data: [
      { id: 5, organization_id: organizationId, branch_id: branchId, product_id: 10, warehouse_id: 2, movement_type: "PURCHASE", quantity: 4, unit_cost: 1000, reference_id: null, reference_type: null, notes: null, created_at: "2026-09-14T10:00:00Z" },
      { id: 4, organization_id: organizationId, branch_id: branchId, product_id: 10, warehouse_id: 3, movement_type: "PURCHASE", quantity: 6, unit_cost: 1000, reference_id: null, reference_type: null, notes: null, created_at: "2026-09-13T10:00:00Z" },
    ], next_cursor: null });
    const getProduct = vi.fn<ErpService["getProduct"]>().mockResolvedValue({ id: 10, organization_id: organizationId, brand_id: null, name: "Cement Bag", sku: "CEM", category: "Cement", unit: "bag", purchase_price: 1000, sale_price: 1200, created_at: "", updated_at: "" });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({ service: { listStockMovements, getProduct }, authenticate: browserAuth, tenantAuthorizer: { assertAuthorized } }));
    const response = await request(app).get("/api/v1/dashboard/stock").set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);

    expect(response.status).toBe(200);
    expect(response.body.data.inventory_items[0]).toEqual(expect.objectContaining({ product_name: "Cement Bag", current_stock: 10, unit: "bag", rate: 1200 }));
    expect(response.body.data.recent_activity[0]).toEqual(expect.objectContaining({ product_name: "Cement Bag", movement_type: "PURCHASE" }));
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "inventory.read", { kind: "branch", branchId });
    expect(listStockMovements).toHaveBeenCalledWith({ limit: 100 }, organizationId, branchId);
  });

  it("does not mix stock movements from another branch", async () => {
    const otherBranch = "44444444-4444-4444-8444-444444444444";
    const listStockMovements = vi.fn<ErpService["listStockMovements"]>().mockImplementation(async (_page, _organization, selectedBranch) => ({
      data: [
        { id: selectedBranch === branchId ? 3 : 2, organization_id: organizationId, branch_id: selectedBranch, product_id: 10, warehouse_id: 2, movement_type: "PURCHASE", quantity: selectedBranch === branchId ? 4 : 90, unit_cost: 1000, reference_id: null, reference_type: null, notes: null, created_at: "2026-09-14T10:00:00Z" },
        ...(selectedBranch === branchId ? [{ id: 1, organization_id: organizationId, branch_id: selectedBranch, product_id: 10, warehouse_id: 2, movement_type: "SALE", quantity: 2, unit_cost: 1000, reference_id: null, reference_type: null, notes: null, created_at: "2026-09-15T10:00:00Z" }] : []),
      ],
      next_cursor: null,
    }));
    const getProduct = vi.fn<ErpService["getProduct"]>().mockResolvedValue({ id: 10, organization_id: organizationId, brand_id: null, name: "Cement", sku: "CEM", category: "Cement", unit: "bag", purchase_price: 1000, sale_price: 1200, created_at: "", updated_at: "" });
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({ service: { listStockMovements, getProduct }, authenticate: browserAuth, tenantAuthorizer: { assertAuthorized: vi.fn().mockResolvedValue(undefined) } }));
    const first = await request(app).get("/api/v1/dashboard/stock").set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);
    const second = await request(app).get("/api/v1/dashboard/stock").set("X-Organization-Id", organizationId).set("X-Branch-Id", otherBranch);
    expect(first.body.data.inventory_items[0].current_stock).toBe(2);
    expect(second.body.data.inventory_items[0].current_stock).toBe(90);
  });
});

describe("dashboard estimate count", () => {
  it("authorizes the selected organization and branch before reading", async () => {
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const countEstimates = vi.fn().mockResolvedValue(7);
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({ authenticate: browserAuth, tenantAuthorizer: { assertAuthorized }, countEstimates }));
    const response = await request(app).get("/api/v1/dashboard/estimates/count").set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { count: 7 } });
    expect(assertAuthorized).toHaveBeenCalledWith({ userId, organizationId }, "sales.read", { kind: "branch", branchId });
    expect(countEstimates).toHaveBeenCalledWith(organizationId, branchId);
  });

  it("rejects unauthorized reads without querying estimates", async () => {
    const countEstimates = vi.fn();
    const app = express();
    app.use("/api/v1/dashboard", createDashboardRouter({ authenticate: browserAuth, tenantAuthorizer: { assertAuthorized: vi.fn().mockRejectedValue(new ApiError(403, "FORBIDDEN", "denied")) }, countEstimates }));
    const response = await request(app).get("/api/v1/dashboard/estimates/count").set("X-Organization-Id", organizationId).set("X-Branch-Id", branchId);
    expect(response.status).toBe(403);
    expect(countEstimates).not.toHaveBeenCalled();
  });
});
