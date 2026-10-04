import { describe, expect, it, vi } from "vitest";
import { authorizedWorkspace, connectPreferredWorkspace, discoverWorkspaces, getWorkspaceContext, normalizeWorkspaceContext, preferredWorkspace, setWorkspaceContext } from "./workspace-context.js";
import { listProducts } from "./product-api.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

describe("shared workspace context", () => {
  it("rejects missing or malformed workspace identifiers", () => { expect(normalizeWorkspaceContext({ organizationId: "org", branchId: "branch" })).toBeNull(); });
  it("stores one central workspace for all modules", () => {
    const store = storage();
    vi.stubGlobal("dispatchEvent", vi.fn());
    vi.stubGlobal("CustomEvent", class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
    setWorkspaceContext(context, store);
    expect(getWorkspaceContext(store)).toEqual(context);
    expect(store.getItem("muraderp.customer-context")).toBeNull();
    expect(store.getItem("muraderp.vendor-context")).toBeNull();
    vi.unstubAllGlobals();
  });
  it("discovers workspaces using only the authenticated browser session", async () => {
    const available = [{ organizationId: "60460719-45f4-4d9b-9fa1-3d81d35ed302", organizationName: "M MURAD BUILDING MATERIALS STORE", branches: [{ branchId: "c57e64ed-da40-40f6-b038-a55e869184b9", branchName: "Main Branch" }] }];
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: available }) });
    vi.stubGlobal("fetch", fetch);
    expect(await discoverWorkspaces()).toEqual(available);
    expect(fetch).toHaveBeenCalledWith("/api/v1/workspaces", { credentials: "include" });
    expect(preferredWorkspace(available)).toEqual({ organizationId: available[0].organizationId, branchId: available[0].branches[0].branchId });
    expect(authorizedWorkspace(available, context.organizationId, context.branchId)).toBeNull();
    expect(authorizedWorkspace(available, available[0].organizationId, context.branchId)).toBeNull();
    vi.unstubAllGlobals();
  });
  it("persists discovered organization and branch IDs for Product request headers", async () => {
    const store = storage();
    const selected = { organizationId: "60460719-45f4-4d9b-9fa1-3d81d35ed302", branchId: "c57e64ed-da40-40f6-b038-a55e869184b9" };
    vi.stubGlobal("dispatchEvent", vi.fn());
    vi.stubGlobal("CustomEvent", class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
    setWorkspaceContext(selected, store);
    expect(getWorkspaceContext(store)).toEqual(selected);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal("fetch", fetch);
    await listProducts(getWorkspaceContext(store));
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ "X-Organization-Id": selected.organizationId, "X-Branch-Id": selected.branchId });
    vi.unstubAllGlobals();
  });
  it("automatically connects the existing authorized organization and Main Branch after login", async () => {
    const store = storage();
    const selected = { organizationId: "60460719-45f4-4d9b-9fa1-3d81d35ed302", branchId: "c57e64ed-da40-40f6-b038-a55e869184b9" };
    vi.stubGlobal("dispatchEvent", vi.fn());
    vi.stubGlobal("CustomEvent", class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ organizationId: selected.organizationId, organizationName: "M MURAD BUILDING MATERIALS STORE", branches: [{ branchId: selected.branchId, branchName: "Main Branch" }] }] }) }));
    const result = await connectPreferredWorkspace(null, store);
    expect(result.selected).toEqual(selected);
    expect(getWorkspaceContext(store)).toEqual(selected);
    vi.unstubAllGlobals();
  });
  it("reports authentication errors without accepting a browser-supplied user ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHORIZED", message: "Sign in" } }) }));
    await expect(discoverWorkspaces()).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    vi.unstubAllGlobals();
  });
});
