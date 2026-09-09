import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { SupabaseErpService, type ErpService } from "../src/services/erp.service.js";
import { ApiError } from "../src/errors/api-error.js";

const TOKEN = "products-security-token-012345678901234567890123";
const PRINCIPAL = "muraderp-products-test-01";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_HEADERS = {
  "X-Organization-Id": ORGANIZATION_ID,
  "X-Branch-Id": BRANCH_ID,
  "X-Actor-User-Id": ACTOR_USER_ID,
};

describe("Products tenant security", () => {
  it("fails closed when an internal caller omits actor, organization, and branch context", async () => {
    const listProducts = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const app = createApp({
      erpService: { listProducts } as unknown as ErpService,
      internalApiToken: TOKEN,
      internalApiPrincipalId: PRINCIPAL,
    });

    const response = await request(app)
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("TRANSACTION_CONTEXT_REQUIRED");
    expect(listProducts).not.toHaveBeenCalled();
  });

  it("requires product read permission and an explicit branch grant before scoped reads", async () => {
    const listProducts = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      erpService: { listProducts } as unknown as ErpService,
      tenantAccessService: { assertAuthorized },
      internalApiToken: TOKEN,
      internalApiPrincipalId: PRINCIPAL,
    });

    const response = await request(app)
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS);

    expect(response.status).toBe(200);
    expect(assertAuthorized).toHaveBeenCalledWith(
      { userId: ACTOR_USER_ID, organizationId: ORGANIZATION_ID },
      "products.read",
      { kind: "branch", branchId: BRANCH_ID },
    );
    expect(listProducts).toHaveBeenCalledWith({ limit: 50 }, ORGANIZATION_ID);
  });

  it("denies Product CRUD before persistence when the actor lacks tenant access", async () => {
    const createProduct = vi.fn();
    const assertAuthorized = vi.fn().mockRejectedValue(
      new ApiError(403, "BRANCH_ACCESS_DENIED", "Explicit active branch grant is required"),
    );
    const app = createApp({
      erpService: { createProduct } as unknown as ErpService,
      tenantAccessService: { assertAuthorized },
      internalApiToken: TOKEN,
      internalApiPrincipalId: PRINCIPAL,
    });

    const response = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS)
      .send({
        name: "Bestway Cement",
        sku: "BESTWAY-OPC",
        category: "Cement",
        unit: "bag",
        purchase_price: 1420,
        sale_price: 1500,
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("BRANCH_ACCESS_DENIED");
    expect(assertAuthorized).toHaveBeenCalledWith(
      { userId: ACTOR_USER_ID, organizationId: ORGANIZATION_ID },
      "products.write",
      { kind: "branch", branchId: BRANCH_ID },
    );
    expect(createProduct).not.toHaveBeenCalled();
  });

  it("passes the authorized organization into product creation", async () => {
    const createProduct = vi.fn().mockResolvedValue({ id: 7 });
    const app = createApp({
      erpService: { createProduct } as unknown as ErpService,
      tenantAccessService: { assertAuthorized: vi.fn().mockResolvedValue(undefined) },
      internalApiToken: TOKEN,
      internalApiPrincipalId: PRINCIPAL,
    });
    const input = {
      name: "Bestway Cement",
      sku: "BESTWAY-OPC",
      category: "Cement",
      unit: "bag",
      purchase_price: 1420,
      sale_price: 1500,
    };

    const response = await request(app)
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS)
      .send(input);

    expect(response.status).toBe(201);
    expect(createProduct).toHaveBeenCalledWith(input, ORGANIZATION_ID);
  });

  it("scopes inventory, movement, and purchase reads to the authorized tenant", async () => {
    const listInventory = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const listStockMovements = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const listPurchases = vi.fn().mockResolvedValue({ data: [], next_cursor: null });
    const assertAuthorized = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      erpService: { listInventory, listStockMovements, listPurchases } as unknown as ErpService,
      tenantAccessService: { assertAuthorized },
      internalApiToken: TOKEN,
      internalApiPrincipalId: PRINCIPAL,
    });

    const inventoryResponse = await request(app)
      .get("/api/v1/inventory")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS);
    const movementResponse = await request(app)
      .get("/api/v1/stock-movements")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS);
    const purchaseResponse = await request(app)
      .get("/api/v1/purchases")
      .set("Authorization", `Bearer ${TOKEN}`)
      .set(TENANT_HEADERS);

    expect([inventoryResponse.status, movementResponse.status, purchaseResponse.status]).toEqual([200, 200, 200]);
    expect(assertAuthorized.mock.calls.map(([, permission]) => permission)).toEqual([
      "inventory.read",
      "inventory.read",
      "purchases.read",
    ]);
    expect(listInventory).toHaveBeenCalledWith({ limit: 50 }, ORGANIZATION_ID);
    expect(listStockMovements).toHaveBeenCalledWith({ limit: 50 }, ORGANIZATION_ID, BRANCH_ID);
    expect(listPurchases).toHaveBeenCalledWith({ limit: 50 }, ORGANIZATION_ID, BRANCH_ID);
  });

  it("enforces organization ownership in every privileged product query", async () => {
    const eq = vi.fn();
    const insert = vi.fn();
    const query: any = {
      select: vi.fn(() => query),
      insert: vi.fn((value: unknown) => { insert(value); return query; }),
      update: vi.fn(() => query),
      delete: vi.fn(() => query),
      eq: vi.fn((...args: unknown[]) => { eq(...args); return query; }),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: { id: 1 }, error: null })),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    const service = new SupabaseErpService(() => ({ from: vi.fn(() => query) }) as any);

    await service.listProducts({ limit: 50 }, ORGANIZATION_ID);
    await service.getProduct(9, ORGANIZATION_ID);
    await service.createProduct({
      name: "Bestway Cement",
      sku: "BESTWAY-OPC",
      category: "Cement",
      unit: "bag",
      purchase_price: 1420,
      sale_price: 1500,
    }, ORGANIZATION_ID);
    await service.updateProduct(9, { sale_price: 1510 }, ORGANIZATION_ID);
    await service.deleteProduct(9, ORGANIZATION_ID);

    expect(eq.mock.calls.filter(([field]) => field === "organization_id"))
      .toEqual(Array.from({ length: 4 }, () => ["organization_id", ORGANIZATION_ID]));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORGANIZATION_ID }));
  });
});
