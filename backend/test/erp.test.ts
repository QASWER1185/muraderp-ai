import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { ErpService, PurchaseDetail } from "../src/services/erp.service.js";

const internalToken = "test_internal_token_1234567890abcdef";
const principalId = "test-principal";
const transactionHeaders = {
  "X-Organization-Id": "11111111-1111-4111-8111-111111111111",
  "X-Branch-Id": "22222222-2222-4222-8222-222222222222",
  "X-Actor-User-Id": "33333333-3333-4333-8333-333333333333",
};

function serviceStub(overrides: Partial<ErpService> = {}): ErpService {
  return { ...overrides } as ErpService;
}

describe("database-backed ERP API", () => {
  it("serves the Phase 21 application shell without exposing server credentials", async () => {
    const response = await request(createApp()).get("/frontend/");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("MuradERP-AI");
    expect(response.text).not.toContain("INTERNAL_API_TOKEN");
    expect(response.text).not.toContain("SUPABASE_SECRET_KEY");
  });

  it("keeps database-backed ERP routes unavailable when server-only credentials are not configured", async () => {
    const response = await request(createApp()).get("/api/v1/purchases");
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ERP_NOT_CONFIGURED");
  });

  it("rejects requests without the internal bearer token", async () => {
    const listCustomers = vi.fn();
    const app = createApp({ erpService: serviceStub({ listCustomers }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).get("/api/v1/customers");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(listCustomers).not.toHaveBeenCalled();
  });

  it("returns keyset-paginated database customers to an authorized caller", async () => {
    const listCustomers = vi.fn().mockResolvedValue({ data: [{ id: 101, organization_id: transactionHeaders["X-Organization-Id"], name: "test_customer_101", phone: "n/a", city: "test_city", created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" }], next_cursor: 101 });
    const tenantAccessService = { assertAuthorized: vi.fn().mockResolvedValue(undefined) };
    const app = createApp({ erpService: serviceStub({ listCustomers }), tenantAccessService, internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).get("/api/v1/customers?cursor=100&limit=1").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders);
    expect(response.status).toBe(200);
    expect(response.body.next_cursor).toBe(101);
    expect(response.body.data).toHaveLength(1);
    expect(listCustomers).toHaveBeenCalledWith({ cursor: 100, limit: 1 }, transactionHeaders["X-Organization-Id"]);
  });

  it("requires Idempotency-Key before purchase persistence", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).send({ vendor_id: 11, warehouse_id: 21, items: [{ product_id: 31, quantity: 3, unit_cost: 10 }] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("passes stable principal, key, and deterministic fingerprint to purchase persistence", async () => {
    const purchase: PurchaseDetail = {
      purchase: { id: 501, organization_id: transactionHeaders["X-Organization-Id"], branch_id: transactionHeaders["X-Branch-Id"], actor_user_id: transactionHeaders["X-Actor-User-Id"], service_principal: principalId, operation_scope: "purchase.create", vendor_id: 11, warehouse_id: 21, purchase_date: "2026-08-09", invoice_number: "test-invoice-501", subtotal: 30, discount: 2, tax: 1, total: 29, notes: "test purchase", created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" },
      items: [{ id: 601, organization_id: transactionHeaders["X-Organization-Id"], branch_id: transactionHeaders["X-Branch-Id"], purchase_id: 501, product_id: 31, quantity: 3, unit_cost: 10, total_cost: 30, created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" }],
    };
    const recordPurchase = vi.fn().mockResolvedValue(purchase);
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const input = { vendor_id: 11, warehouse_id: 21, items: [{ product_id: 31, quantity: 3, unit_cost: 10 }], purchase_date: "2026-08-09", invoice_number: " TEST-INVOICE-501 ", discount: 2, tax: 1, notes: "test purchase" };
    const first = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "purchase-key-501").send(input);
    const second = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "purchase-key-501").send({ ...input, invoice_number: "test-invoice-501" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(recordPurchase).toHaveBeenCalledTimes(2);
    expect(recordPurchase.mock.calls[0]![1]).toMatchObject({
      organizationId: transactionHeaders["X-Organization-Id"],
      branchId: transactionHeaders["X-Branch-Id"],
      actorUserId: transactionHeaders["X-Actor-User-Id"],
      servicePrincipalId: principalId,
      operation: "purchase.create",
      idempotencyKey: "purchase-key-501",
    });
    expect(recordPurchase.mock.calls[1]![1].requestFingerprint).toBe(recordPurchase.mock.calls[0]![1].requestFingerprint);
  });

  it("validates an atomic purchase before calling the database function", async () => {
    const purchase: PurchaseDetail = {
      purchase: { id: 501, organization_id: transactionHeaders["X-Organization-Id"], branch_id: transactionHeaders["X-Branch-Id"], actor_user_id: transactionHeaders["X-Actor-User-Id"], service_principal: principalId, operation_scope: "purchase.create", vendor_id: 11, warehouse_id: 21, purchase_date: "2026-08-09", invoice_number: "test-invoice-501", subtotal: 30, discount: 2, tax: 1, total: 29, notes: "test purchase", created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" },
      items: [{ id: 601, organization_id: transactionHeaders["X-Organization-Id"], branch_id: transactionHeaders["X-Branch-Id"], purchase_id: 501, product_id: 31, quantity: 3, unit_cost: 10, total_cost: 30, created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" }],
    };
    const recordPurchase = vi.fn().mockResolvedValue(purchase);
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "purchase-key-legacy-test").send({ vendor_id: 11, warehouse_id: 21, items: [{ product_id: 31, quantity: 3, unit_cost: 10 }], purchase_date: "2026-08-09", invoice_number: "test-invoice-501", discount: 2, tax: 1, notes: "test purchase" });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(purchase);
    expect(recordPurchase).toHaveBeenCalledOnce();
  });

  it("rejects a partial purchase before any persistent call", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "purchase-validation-test").send({ vendor_id: 11, warehouse_id: 21, items: [] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("rejects non-positive purchase quantities before persistence", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    for (const quantity of [0, -1]) {
      const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", `quantity-${quantity}`).send({ vendor_id: 11, warehouse_id: 21, items: [{ product_id: 31, quantity, unit_cost: 10 }] });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("rejects non-positive purchase unit costs before persistence", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    for (const unitCost of [0, -0.01]) {
      const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", `unit-cost-${unitCost}`).send({ vendor_id: 11, warehouse_id: 21, items: [{ product_id: 31, quantity: 1, unit_cost: unitCost }] });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect(recordPurchase).not.toHaveBeenCalled();
  });

  it("does not persist when a purchase line references an invalid product id", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({ erpService: serviceStub({ recordPurchase }), internalApiToken: internalToken, internalApiPrincipalId: principalId });
    const response = await request(app).post("/api/v1/purchases").set("Authorization", `Bearer ${internalToken}`).set(transactionHeaders).set("Idempotency-Key", "invalid-product-reference").send({ vendor_id: 11, warehouse_id: 21, items: [{ product_id: -1, quantity: 1, unit_cost: 10 }] });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPurchase).not.toHaveBeenCalled();
  });
});
