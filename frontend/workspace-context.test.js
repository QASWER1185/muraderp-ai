import { describe, expect, it, vi } from "vitest";
import { getWorkspaceContext, normalizeWorkspaceContext, setWorkspaceContext } from "./workspace-context.js";

const context = { organizationId: "11111111-1111-4111-8111-111111111111", branchId: "22222222-2222-4222-8222-222222222222" };
function storage() { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }; }

describe("shared workspace context", () => {
  it("rejects missing or malformed workspace identifiers", () => { expect(normalizeWorkspaceContext({ organizationId: "org", branchId: "branch" })).toBeNull(); });
  it("shares a valid workspace with existing customer and vendor modules", () => {
    const store = storage();
    vi.stubGlobal("dispatchEvent", vi.fn());
    vi.stubGlobal("CustomEvent", class { constructor(type, init) { this.type = type; this.detail = init.detail; } });
    setWorkspaceContext(context, store);
    expect(getWorkspaceContext(store)).toEqual(context);
    expect(JSON.parse(store.getItem("muraderp.customer-context"))).toEqual(context);
    vi.unstubAllGlobals();
  });
});
