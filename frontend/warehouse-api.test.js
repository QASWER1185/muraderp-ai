import { afterEach, describe, expect, it, vi } from "vitest";
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse } from "./warehouse-api.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());
describe("Warehouse browser API", () => {
  it("uses the one central context and browser session for reads", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }); vi.stubGlobal("fetch", fetch);
    await listWarehouses(context, { limit: 25 }); await getWarehouse(context, 5);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/warehouses?limit=25", "/api/v1/warehouses/5"]);
    for (const [, options] of fetch.mock.calls) expect(options).toMatchObject({ credentials: "include", headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId } });
  });
  it("writes without exposing a service credential", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: 5 } }) }); vi.stubGlobal("fetch", fetch);
    await createWarehouse(context, { name: "West", location: null }); await updateWarehouse(context, 5, { name: "West Main" });
    expect(fetch.mock.calls.map(([, options]) => options.method)).toEqual(["POST", "PATCH"]);
    for (const [, options] of fetch.mock.calls) expect(options.headers.Authorization).toBeUndefined();
  });
  it("fails before fetch without a workspace", async () => { const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); await expect(listWarehouses(null)).rejects.toMatchObject({ code: "WORKSPACE_REQUIRED" }); expect(fetch).not.toHaveBeenCalled(); });
});
