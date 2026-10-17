import express, { type RequestHandler } from "express";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { TenantAccessService } from "../src/auth/tenant-access.service.js";
import { ApiError } from "../src/errors/api-error.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createVendorRouter } from "../src/routes/vendor.routes.js";
import { SupabaseErpService, type ErpService } from "../src/services/erp.service.js";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";
const HEADERS = { "X-Organization-Id": ORGANIZATION_ID, "X-Branch-Id": BRANCH_ID };
const vendor = {
  id: 7,
  organization_id: ORGANIZATION_ID,
  name: "Bestway Cement",
  phone: "03007654321",
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
  app.use("/vendors", createVendorRouter({ service, tenantAuthorizer, authenticate: browserAuth() }));
  app.use(errorHandler);
  return app;
}

describe("browser-safe vendor gateway", () => {
  it("lists only through verified browser, organization, branch, and read-permission context", async () => {
    const listVendors = vi.fn().mockResolvedValue({ data: [vendor], next_cursor: null });
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ listVendors }), tenantAuthorizer))
      .get("/vendors?limit=20")
      .set(HEADERS);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([vendor]);
    expect(tenantAuthorizer.assertAuthorized).toHaveBeenCalledWith(
      { userId: USER_ID, organizationId: ORGANIZATION_ID },
      "vendors.read",
      { kind: "branch", branchId: BRANCH_ID },
    );
    expect(listVendors).toHaveBeenCalledWith({ limit: 20 }, ORGANIZATION_ID);
  });

  it("creates and updates through the existing organization-scoped vendor service", async () => {
    const createVendor = vi.fn().mockResolvedValue(vendor);
    const updateVendor = vi.fn().mockResolvedValue({ ...vendor, city: "Islamabad" });
    const tenantAuthorizer = authorizer();
    const app = testApp(serviceStub({ createVendor, updateVendor }), tenantAuthorizer);

    const created = await request(app).post("/vendors").set(HEADERS).send({ name: vendor.name, phone: vendor.phone, city: vendor.city });
    const updated = await request(app).patch("/vendors/7").set(HEADERS).send({ city: "Islamabad" });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(createVendor).toHaveBeenCalledWith({ name: vendor.name, phone: vendor.phone, city: vendor.city }, ORGANIZATION_ID);
    expect(updateVendor).toHaveBeenCalledWith(7, { city: "Islamabad" }, ORGANIZATION_ID);
    expect(tenantAuthorizer.assertAuthorized).toHaveBeenCalledWith(
      { userId: USER_ID, organizationId: ORGANIZATION_ID },
      "vendors.write",
      { kind: "branch", branchId: BRANCH_ID },
    );
  });

  it("fails closed when the session actor and requested actor do not match", async () => {
    const listVendors = vi.fn();
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ listVendors }), tenantAuthorizer))
      .get("/vendors")
      .set(HEADERS)
      .set("X-Actor-User-Id", "44444444-4444-4444-8444-444444444444");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(tenantAuthorizer.assertAuthorized).not.toHaveBeenCalled();
    expect(listVendors).not.toHaveBeenCalled();
  });

  it("renders permission denials without reaching vendor persistence", async () => {
    const createVendor = vi.fn();
    const tenantAuthorizer = authorizer(async () => {
      throw new ApiError(403, "PERMISSION_DENIED", "Required organization permission is not granted");
    });
    const response = await request(testApp(serviceStub({ createVendor }), tenantAuthorizer))
      .post("/vendors")
      .set(HEADERS)
      .send({ name: vendor.name, phone: vendor.phone, city: vendor.city });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PERMISSION_DENIED");
    expect(createVendor).not.toHaveBeenCalled();
  });

  it("rejects unknown vendor fields before persistence", async () => {
    const createVendor = vi.fn();
    const tenantAuthorizer = authorizer();
    const response = await request(testApp(serviceStub({ createVendor }), tenantAuthorizer))
      .post("/vendors")
      .set(HEADERS)
      .send({ name: vendor.name, phone: vendor.phone, city: vendor.city, organization_id: "forged" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(createVendor).not.toHaveBeenCalled();
  });

  it("enforces organization ownership in every vendor persistence query", async () => {
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
      single: vi.fn(async () => ({ data: vendor, error: null })),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    const service = new SupabaseErpService(() => ({ from: vi.fn(() => query) }) as any);

    await service.listVendors({ limit: 50 }, ORGANIZATION_ID);
    await service.getVendor(7, ORGANIZATION_ID);
    await service.createVendor({ name: vendor.name, phone: vendor.phone, city: vendor.city }, ORGANIZATION_ID);
    await service.updateVendor(7, { city: "Islamabad" }, ORGANIZATION_ID);
    await service.deleteVendor(7, ORGANIZATION_ID);

    expect(eq.mock.calls.filter(([field]) => field === "organization_id"))
      .toEqual(Array.from({ length: 4 }, () => ["organization_id", ORGANIZATION_ID]));
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORGANIZATION_ID }));
  });
});
