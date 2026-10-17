import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversionSession } from "./estimate-conversion.js";
afterEach(() => vi.unstubAllGlobals());
const context = { sourceId: 50, organizationId: "org", branchId: "branch" };
const payload = { mode: "PRESERVE_LINE_BRAND_CONTEXT", pricing_date: "2026-09-09" };
const response = (data) => ({ ok: true, json: async () => ({ data }) });

describe("estimate conversion browser confirmation", () => {
  it("requires a resolved preview and sends the approved fingerprint with session credentials", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ can_create: true, preview_fingerprint: "approved" })).mockResolvedValueOnce(response({ id: 99 }));
    vi.stubGlobal("fetch", fetch);
    const session = createConversionSession();
    await expect(session.confirm("EST-99")).rejects.toThrow("Review a fully resolved preview");
    await session.preview(context, payload);
    await expect(session.confirm("EST-99")).resolves.toEqual({ id: 99 });
    expect(fetch.mock.calls[1][1].credentials).toBe("include");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...payload, target_estimate_number: "EST-99", preview_fingerprint: "approved" });
    await expect(session.confirm("EST-99")).rejects.toThrow("Review");
  });

  it("retains the same key and payload after a network failure", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ can_create: true, preview_fingerprint: "approved" })).mockRejectedValueOnce(new Error("connection lost")).mockResolvedValueOnce(response({ id: 99 }));
    vi.stubGlobal("fetch", fetch);
    const session = createConversionSession();
    await session.preview(context, payload);
    await expect(session.confirm("EST-99")).rejects.toThrow("connection lost");
    await session.confirm("EST-99");
    expect(fetch.mock.calls[1]).toEqual(fetch.mock.calls[2]);
  });

  it("invalidates approval when inputs change or a preview contains failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ can_create: true, preview_fingerprint: "approved" })).mockResolvedValueOnce(response({ can_create: false })));
    const session = createConversionSession();
    await session.preview(context, payload); session.clear();
    await expect(session.confirm("EST-99")).rejects.toThrow("Review");
    await session.preview(context, payload);
    await expect(session.confirm("EST-99")).rejects.toThrow("Review");
  });
});
