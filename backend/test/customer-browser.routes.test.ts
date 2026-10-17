import express, { type RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/errors/api-error.js";
import type { TenantAccessService } from "../src/auth/tenant-access.service.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createCustomerRouter } from "../src/routes/customer.routes.js";
import { SupabaseErpService, type ErpService } from "../src/services/erp.service.js";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const HEADERS = { "X-Organization-Id": ORGANIZATION_ID, "X-Branch-Id": BRANCH_ID };
const customer = {
  id: 7,
  organization_id: ORGANIZATION_ID,
  name: "Ali Raza",
  phone: "03001234567",
  city: "Lahore",
  created_at: "2026-09-10T00:00:00.000Z",
  updated_at: "2026-09-10T00:00:00.000Z",
};

function browserAuth(userId = USER_ID): RequestHandler {
  return (request, _response, next) => {
    request.browserPrincipal = { userId };
    next();
  };
}

function serviceStub(overrides: Partial<ErpService>): ErpService {
  return overrides as ErpService;
}

function authorizer(implementation: TenantAccessService["assertAuthorized"] = async () => undefined) {
  return { assertAuthorized: vi.fn(implementation) };
}

function testApp(service: ErpService, tenantAuthorizer: Pick<TenantAccessService, "assertAuthorized">) {
  const app = express();
  app.use(pinoHttp({ enabled: false }));
  app.use(express.json());
  app.use("/customers", createCustomerRouter({ service, tenantAuthorizer, authenticate: browserAuth() }));
  app.use(errorHandler);
  return app;
}

describe("browser-safe customer gateway", () => {
  it("lists only through verified browser, organization, branch, and read-permission context", async () => {
    const listCustomers = vi.fn().mockResolvedValue({ data: [customer], next_cursor: null });
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ listCustomers }), tenantAuthorizer))
      .get("/customers?limit=20")
      .set(HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([customer]);
    expect(tenantAuthorizer.assertAuthorized).toHaveBeenCalledWith(
      { userId: USER_ID, organizationId: ORGANIZATION_ID },
      "customers.read",
      { kind: "branch", branchId: BRANCH_ID },
    );
    expect(listCustomers).toHaveBeenCalledWith({ limit: 20 }, ORGANIZATION_ID);
  });

  it("creates and updates through the existing organization-scoped customer service", async () => {
    const createCustomer = vi.fn().mockResolvedValue(customer);
    const updateCustomer = vi.fn().mockResolvedValue({ ...customer, city: "Islamabad" });
    const tenantAuthorizer = authorizer();
    const app = testApp(serviceStub({ createCustomer, updateCustomer }), tenantAuthorizer);

    const created = await request(app).post("/customers").set(HEADERS).send({ name: customer.name, phone: customer.phone, city: customer.city });
    const updated = await request(app).patch("/customers/7").set(HEADERS).send({ city: "Islamabad" });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(createCustomer).toHaveBeenCalledWith({ name: customer.name, phone: customer.phone, city: customer.city }, ORGANIZATION_ID);
    expect(updateCustomer).toHaveBeenCalledWith(7, { city: "Islamabad" }, ORGANIZATION_ID);
    expect(tenantAuthorizer.assertAuthorized).toHaveBeenCalledWith(
      { userId: USER_ID, organizationId: ORGANIZATION_ID },
      "customers.write",
      { kind: "branch", branchId: BRANCH_ID },
    );
  });

  it("fails closed when the session actor and requested actor do not match", async () => {
    const listCustomers = vi.fn();
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ listCustomers }), tenantAuthorizer))
      .get("/customers")
      .set(HEADERS)
      .set("X-Actor-User-Id", "44444444-4444-4444-8444-444444444444");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(tenantAuthorizer.assertAuthorized).not.toHaveBeenCalled();
    expect(listCustomers).not.toHaveBeenCalled();
  });

  it("renders permission denials without reaching customer persistence", async () => {
    const createCustomer = vi.fn();
    const tenantAuthorizer = authorizer(async () => {
      throw new ApiError(403, "PERMISSION_DENIED", "Required organization permission is not granted");
    });
    const response = await request(testApp(serviceStub({ createCustomer }), tenantAuthorizer))
      .post("/customers")
      .set(HEADERS)
      .send({ name: customer.name, phone: customer.phone, city: customer.city });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("rejects unknown customer fields before persistence", async () => {
    const createCustomer = vi.fn();
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ createCustomer }), tenantAuthorizer))
      .post("/customers")
      .set(HEADERS)
      .send({ name: customer.name, phone: customer.phone, city: customer.city, organization_id: "forged" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("enforces organization ownership in every customer persistence query", async () => {
    const eq = vi.fn();
    const insert = vi.fn();
    const query: any = {
      select: vi.fn(() => query),
      insert: vi.fn((value: unknown) => { insert(value); return query; }),
      update: vi.fn(() => query),
      delete: vi.fn(() => query),
      eq: vi.fn((...args: unknown[]) => { eq(...args); return query; }),
      gt: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: customer, error: null })),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    const service = new SupabaseErpService(() => ({ from: vi.fn(() => query) }) as any);

    await service.listCustomers({ limit: 50 }, ORGANIZATION_ID);
    await service.getCustomer(7, ORGANIZATION_ID);
    await service.createCustomer({ name: customer.name, phone: customer.phone, city: customer.city }, ORGANIZATION_ID);
    await service.updateCustomer(7, { city: "Islamabad" }, ORGANIZATION_ID);
    await service.deleteCustomer(7, ORGANIZATION_ID);

    expect(eq.mock.calls.filter(([field]) => field === "organization_id"))
      .toEqual(Array.from({ length: 4 }, () => ["organization_id", ORGANIZATION_ID]));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORGANIZATION_ID }));
  });
});
