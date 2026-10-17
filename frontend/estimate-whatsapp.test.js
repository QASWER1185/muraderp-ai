import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareEstimateWhatsAppShare } from "./estimate-conversion.js";

afterEach(() => vi.unstubAllGlobals());

describe("Estimate WhatsApp share browser API", () => {
  it("requests a tenant-scoped prepared WhatsApp link", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { share_url: "https://wa.me/923001234567?text=Estimate", phone: "923001234567" } }),
    });
    vi.stubGlobal("fetch", fetch);

    const result = await prepareEstimateWhatsAppShare({ estimateId: 50, organizationId: "org-1", branchId: "branch-1" });

    expect(result.phone).toBe("923001234567");
    expect(fetch).toHaveBeenCalledWith("/api/v1/estimates/50/whatsapp-share", {
      method: "GET", credentials: "include", headers: { "X-Organization-Id": "org-1", "X-Branch-Id": "branch-1" },
    });
  });

  it("rejects a non-WhatsApp redirect supplied by the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { share_url: "https://example.com/redirect" } }) }));
    await expect(prepareEstimateWhatsAppShare({ estimateId: 50, organizationId: "org-1", branchId: "branch-1" }))
      .rejects.toThrow("invalid destination");
  });
});
