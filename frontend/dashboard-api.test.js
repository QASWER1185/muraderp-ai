import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboardEstimateCount, getDashboardMetric, getDashboardStock } from "./dashboard-api.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
afterEach(() => vi.unstubAllGlobals());

describe("dashboard browser API", () => {
  it("loads stock through the authenticated tenant boundary", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { inventory_items: [] } }) });
    vi.stubGlobal("fetch", fetch);
    await getDashboardStock(context);
    expect(fetch).toHaveBeenCalledWith("/api/v1/dashboard/stock", { credentials: "include", headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId } });
  });

  it("requests profit only for the explicit date range", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { value: "PKR 0" } }) });
    vi.stubGlobal("fetch", fetch);
    await getDashboardMetric(context, "profit", { from: "2026-09-01", to: "2026-09-14" });
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/browser/reports/details?head=profit&from=2026-09-01&to=2026-09-14");
    expect(fetch.mock.calls[0][1].headers).toEqual({ "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId });
  });

  it("loads estimate count through the scoped dashboard endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { count: 3 } }) });
    vi.stubGlobal("fetch", fetch);
    expect((await getDashboardEstimateCount(context)).data.count).toBe(3);
    expect(fetch).toHaveBeenCalledWith("/api/v1/dashboard/estimates/count", { credentials: "include", headers: { "X-Organization-Id": context.organizationId, "X-Branch-Id": context.branchId } });
  });
});
