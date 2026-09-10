import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import type { ErpService } from "../services/erp.service.js";

const TOKEN = "phase5-test-token-012345678901234567890123456789";
const PRINCIPAL = "muraderp-api-test-01";
const TENANT_HEADERS = {
  "X-Organization-Id": "11111111-1111-4111-8111-111111111111",
  "X-Branch-Id": "22222222-2222-4222-8222-222222222222",
  "X-Actor-User-Id": "33333333-3333-4333-8333-333333333333",
};
const tenantAccessService = { assertAuthorized: vi.fn(async () => undefined) };

function makeService(): ErpService {
  const rows = {
    brands: { id: 1, name: "GM", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" },
    customers: { id: 2, organization_id: TENANT_HEADERS["X-Organization-Id"], name: "Ali Raza", phone: "03001234567", city: "Lahore", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" },
    vendors: { id: 3, name: "Bestway", phone: "03007654321", city: "Lahore", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" },
    products: { id: 4, brand_id: 1, name: "GM Cable", sku: "GM-CABLE-01", category: "Electrical", unit: "coil", purchase_price: 100, sale_price: 120, created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" },
    warehouses: { id: 5, name: "Main Warehouse", location: "Lahore", created_at: "2026-08-20T00:00:00Z", updated_at: "2026-08-20T00:00:00Z" },
  };

  return {
    listBrands: vi.fn(async () => ({ data: [rows.brands], next_cursor: null })),
    getBrand: vi.fn(async () => rows.brands),
    createBrand: vi.fn(async (input) => ({ ...rows.brands, ...input })),
    updateBrand: vi.fn(async (_id, input) => ({ ...rows.brands, ...input })),
    deleteBrand: vi.fn(async () => true),

    listCustomers: vi.fn(async () => ({ data: [rows.customers], next_cursor: null })),
    getCustomer: vi.fn(async () => rows.customers),
    createCustomer: vi.fn(async (input) => ({ ...rows.customers, ...input })),
    updateCustomer: vi.fn(async (_id, input) => ({ ...rows.customers, ...input })),
    deleteCustomer: vi.fn(async () => true),

    listVendors: vi.fn(async () => ({ data: [rows.vendors], next_cursor: null })),
    getVendor: vi.fn(async () => rows.vendors),
    createVendor: vi.fn(async (input) => ({ ...rows.vendors, ...input })),
    updateVendor: vi.fn(async (_id, input) => ({ ...rows.vendors, ...input })),
    deleteVendor: vi.fn(async () => true),

    listProducts: vi.fn(async () => ({ data: [rows.products], next_cursor: null })),
    getProduct: vi.fn(async () => rows.products),
    createProduct: vi.fn(async (input) => ({ ...rows.products, ...input })),
    updateProduct: vi.fn(async (_id, input) => ({ ...rows.products, ...input })),
    deleteProduct: vi.fn(async () => true),

    listWarehouses: vi.fn(async () => ({ data: [rows.warehouses], next_cursor: null })),
    getWarehouse: vi.fn(async () => rows.warehouses),
    createWarehouse: vi.fn(async (input) => ({ ...rows.warehouses, ...input })),
    updateWarehouse: vi.fn(async (_id, input) => ({ ...rows.warehouses, ...input })),
    deleteWarehouse: vi.fn(async () => true),

    listInventory: vi.fn(async () => ({ data: [], next_cursor: null })),
    listStockMovements: vi.fn(async () => ({ data: [], next_cursor: null })),
    listPurchases: vi.fn(async () => ({ data: [], next_cursor: null })),
    getPurchase: vi.fn(async () => null),
    recordPurchase: vi.fn(async () => ({ purchase: {} as never, items: [] })),
  } as unknown as ErpService;
}

describe("Phase 5 master-data acceptance", () => {
  const resources = [
    { path: "brands", valid: { name: "GM" } },
    { path: "customers", valid: { name: "Ali Raza", phone: "03001234567", city: "Lahore" } },
    { path: "vendors", valid: { name: "Bestway", phone: "03007654321", city: "Lahore" } },
    { path: "products", valid: { brand_id: 1, name: "GM Cable", sku: "GM-CABLE-01", category: "Electrical", unit: "coil", purchase_price: 100, sale_price: 120 } },
    { path: "warehouses", valid: { name: "Main Warehouse", location: "Lahore" } },
  ] as const;

  it("requires the internal API token", async () => {
    const app = createApp({ erpService: makeService(), tenantAccessService, internalApiToken: TOKEN, internalApiPrincipalId: PRINCIPAL });
    const response = await request(app).get("/api/v1/brands");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  for (const resource of resources) {
    it(`${resource.path} supports list/create/update/delete`, async () => {
      const service = makeService();
      const app = createApp({ erpService: service, tenantAccessService, internalApiToken: TOKEN, internalApiPrincipalId: PRINCIPAL });
      const auth = { Authorization: `Bearer ${TOKEN}`, ...TENANT_HEADERS };

      expect((await request(app).get(`/api/v1/${resource.path}`).set(auth)).status).toBe(200);
      expect((await request(app).post(`/api/v1/${resource.path}`).set(auth).send(resource.valid)).status).toBe(201);
      expect((await request(app).patch(`/api/v1/${resource.path}/1`).set(auth).send(resource.valid)).status).toBe(200);
      expect((await request(app).delete(`/api/v1/${resource.path}/1`).set(auth)).status).toBe(204);
    });

    it(`${resource.path} rejects unknown create fields`, async () => {
      const app = createApp({ erpService: makeService(), tenantAccessService, internalApiToken: TOKEN, internalApiPrincipalId: PRINCIPAL });
      const response = await request(app)
        .post(`/api/v1/${resource.path}`)
        .set("Authorization", `Bearer ${TOKEN}`)
        .set(TENANT_HEADERS)
        .send({ ...resource.valid, unexpected: "blocked" });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });
  }

  it("rejects invalid pagination without reaching the service", async () => {
    const service = makeService();
    const app = createApp({ erpService: service, tenantAccessService, internalApiToken: TOKEN, internalApiPrincipalId: PRINCIPAL });
    const response = await request(app)
      .get("/api/v1/products?limit=101")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(service.listProducts).not.toHaveBeenCalled();
  });
});
