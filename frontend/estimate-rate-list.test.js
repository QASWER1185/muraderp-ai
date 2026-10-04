import { afterEach, describe, expect, it, vi } from "vitest";
import { listEstimateRateLists, previewEstimateRateList } from "./estimate-conversion.js";

afterEach(() => vi.unstubAllGlobals());

const context = { organizationId: "org-1", branchId: "branch-1" };

describe("Estimate rate-list browser API", () => {
  it("loads authorized company choices without putting workspace IDs in the URL", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: 4, name: "GM", code: "GM" }] }) });
    vi.stubGlobal("fetch", fetch);
    await expect(listEstimateRateLists(context, { customerId: 7 })).resolves.toEqual([{ id: 4, name: "GM", code: "GM" }]);
    expect(fetch).toHaveBeenCalledWith("/api/v1/estimates/rate-lists?currency_code=PKR&customer_id=7", expect.objectContaining({ credentials: "include", headers: expect.objectContaining({ "X-Organization-Id": "org-1", "X-Branch-Id": "branch-1" }) }));
  });

  it("requests an authorized product-match preview before rates are applied", async () => {
    const data = { matched: 1, needs_review: 0, can_apply: true, lines: [{ product_id: 10, old_rate: 1200, new_rate: 1275, status: "MATCHED" }] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) });
    vi.stubGlobal("fetch", fetch);
    const payload = { customer_id: 7, target_rate_list_id: 4, pricing_date: "2026-09-14", currency_code: "PKR", lines: [{ product_id: 10, quantity: 2, unit: "bag", current_unit_price: 1200 }] };
    await expect(previewEstimateRateList(context, payload)).resolves.toEqual(data);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(payload);
  });
});
