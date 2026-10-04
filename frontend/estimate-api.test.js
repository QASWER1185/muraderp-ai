import { afterEach, describe, expect, it, vi } from "vitest";
import { createEstimateDraft } from "./estimate-api.js";

afterEach(() => vi.unstubAllGlobals());

describe("estimate browser API", () => {
  it("uses the session boundary, tenant headers, and retry key", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ data: { id: 91 } }) });
    vi.stubGlobal("fetch", fetch);
    const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
    await createEstimateDraft(context, { customer_id: 7, lines: [] }, "estimate-fixed-key");
    expect(fetch).toHaveBeenCalledWith("/api/v1/estimates", expect.objectContaining({
      method: "POST",
      credentials: "include",
      headers: expect.objectContaining({
        "X-Organization-Id": context.organizationId,
        "X-Branch-Id": context.branchId,
        "Idempotency-Key": "estimate-fixed-key",
      }),
    }));
  });
});
