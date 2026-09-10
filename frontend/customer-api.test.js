import { afterEach, describe, expect, it, vi } from "vitest";
import { createCustomer, listCustomers, normalizeCustomerContext, updateCustomer } from "./customer-api.js";

const context = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  branchId: "22222222-2222-4222-8222-222222222222",
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => vi.unstubAllGlobals());

describe("customer browser API", () => {
  it("loads a page with session credentials and explicit tenant context", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: [], next_cursor: 50 }));
    vi.stubGlobal("fetch", fetch);

    await listCustomers(context, { cursor: 10, limit: 40 });

    expect(fetch).toHaveBeenCalledWith("/api/v1/customers?limit=40&cursor=10", expect.objectContaining({
      credentials: "include",
      headers: expect.objectContaining({
        "X-Organization-Id": context.organizationId,
        "X-Branch-Id": context.branchId,
      }),
    }));
  });

  it("creates and updates validated customer payloads without privileged credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: 7 } }, 201));
    vi.stubGlobal("fetch", fetch);
    const input = { name: "Ali Raza", phone: "03001234567", city: "Lahore" };

    await createCustomer(context, input);
    await updateCustomer(context, 7, { city: "Islamabad" });

    expect(fetch.mock.calls[0]).toEqual(["/api/v1/customers", expect.objectContaining({ method: "POST", body: JSON.stringify(input) })]);
    expect(fetch.mock.calls[1]).toEqual(["/api/v1/customers/7", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ city: "Islamabad" }) })]);
    for (const [, options] of fetch.mock.calls) {
      expect(options.headers).not.toHaveProperty("Authorization");
      expect(options.headers).not.toHaveProperty("X-Actor-User-Id");
    }
  });

  it("preserves server permission errors for the customer UI", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: { code: "PERMISSION_DENIED", message: "Customers are read only" } }, 403)));
    await expect(listCustomers(context)).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED", message: "Customers are read only" });
  });

  it("rejects invalid tenant context before making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(() => normalizeCustomerContext({ organizationId: "not-a-uuid", branchId: context.branchId })).toThrow("valid organization");
    await expect(listCustomers({ organizationId: context.organizationId, branchId: "" })).rejects.toThrow("valid branch");
    expect(fetch).not.toHaveBeenCalled();
  });
});
