import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { ErpService, PurchaseDetail } from "../src/services/erp.service.js";

const internalToken = "test_internal_token_1234567890abcdef";

function serviceStub(overrides: Partial<ErpService> = {}): ErpService {
  return {
    ...overrides,
  } as ErpService;
}

describe("database-backed ERP API", () => {
  it("stays unavailable when server-only credentials are not configured", async () => {
    const response = await request(createApp()).get("/api/v1/customers");

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("ERP_NOT_CONFIGURED");
  });

  it("rejects requests without the internal bearer token", async () => {
    const listCustomers = vi.fn();
    const app = createApp({
      erpService: serviceStub({ listCustomers }),
      internalApiToken: internalToken,
    });

    const response = await request(app).get("/api/v1/customers");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(listCustomers).not.toHaveBeenCalled();
  });

  it("returns keyset-paginated database customers to an authorized caller", async () => {
    const listCustomers = vi.fn().mockResolvedValue({
      data: [
        {
          id: 101,
          name: "test_customer_101",
          phone: "n/a",
          city: "test_city",
          created_at: "2026-08-09T00:00:00.000Z",
          updated_at: "2026-08-09T00:00:00.000Z",
        },
      ],
      next_cursor: 101,
    });
    const app = createApp({
      erpService: serviceStub({ listCustomers }),
      internalApiToken: internalToken,
    });

    const response = await request(app)
      .get("/api/v1/customers?cursor=100&limit=1")
      .set("Authorization", `Bearer ${internalToken}`);

    expect(response.status).toBe(200);
    expect(response.body.next_cursor).toBe(101);
    expect(response.body.data).toHaveLength(1);
    expect(listCustomers).toHaveBeenCalledWith({ cursor: 100, limit: 1 });
  });

  it("validates an atomic purchase before calling the database function", async () => {
    const purchase: PurchaseDetail = {
      purchase: {
        id: 501,
        vendor_id: 11,
        warehouse_id: 21,
        purchase_date: "2026-08-09",
        invoice_number: "test-invoice-501",
        subtotal: 30,
        discount: 2,
        tax: 1,
        total: 29,
        notes: "test purchase",
        created_at: "2026-08-09T00:00:00.000Z",
        updated_at: "2026-08-09T00:00:00.000Z",
      },
      items: [
        {
          id: 601,
          purchase_id: 501,
          product_id: 31,
          quantity: 3,
          unit_cost: 10,
          total_cost: 30,
          created_at: "2026-08-09T00:00:00.000Z",
          updated_at: "2026-08-09T00:00:00.000Z",
        },
      ],
    };
    const recordPurchase = vi.fn().mockResolvedValue(purchase);
    const app = createApp({
      erpService: serviceStub({ recordPurchase }),
      internalApiToken: internalToken,
    });
    const input = {
      vendor_id: 11,
      warehouse_id: 21,
      items: [{ product_id: 31, quantity: 3, unit_cost: 10 }],
      purchase_date: "2026-08-09",
      invoice_number: "test-invoice-501",
      discount: 2,
      tax: 1,
      notes: "test purchase",
    };

    const response = await request(app)
      .post("/api/v1/purchases")
      .set("Authorization", `Bearer ${internalToken}`)
      .send(input);

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual(purchase);
    expect(recordPurchase).toHaveBeenCalledOnce();
    expect(recordPurchase).toHaveBeenCalledWith(input);
  });

  it("rejects a partial purchase before any persistent call", async () => {
    const recordPurchase = vi.fn();
    const app = createApp({
      erpService: serviceStub({ recordPurchase }),
      internalApiToken: internalToken,
    });

    const response = await request(app)
      .post("/api/v1/purchases")
      .set("Authorization", `Bearer ${internalToken}`)
      .send({ vendor_id: 11, warehouse_id: 21, items: [] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(recordPurchase).not.toHaveBeenCalled();
  });
});
