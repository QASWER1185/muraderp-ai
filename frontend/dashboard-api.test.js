import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboardStock } from "./dashboard-api.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("dashboard browser API", () => {
  it("loads stock through the authenticated tenant boundary", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { inventory_items: [] } }) });
    vi.stubGlobal("fetch", fetch);
    await getDashboardStock(context);
    expect(fetch).toHaveBeenCalledWith("/api/v1/dashboard/stock", { credentials: "include", headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId } });
  });

  it("rejects an invalid workspace before sending a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(getDashboardStock({ organizationId: "invalid", branchId: context.branchId })).rejects.toMatchObject({ status: 400, code: "WORKSPACE_REQUIRED" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
