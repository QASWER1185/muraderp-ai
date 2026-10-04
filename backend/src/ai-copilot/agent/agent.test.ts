import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors/api-error.js";
import { readConversation } from "./conversation.js";
import { ReadOnlyCopilotAgent } from "./agent.js";
import { ErpToolRegistry, ERP_TOOLS, type AgentScope, type ToolServices } from "./erp-tools.js";
import type { AgentModel, ModelStep } from "./model.js";

const scope: AgentScope = { userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
const product = { id: 7, name: "25mm PN20 pipe", sku: "P-25", category: "Pipes", unit: "pcs", brand_id: 4, sale_price: 999, purchase_price: 50 };
function services(): ToolServices {
  return {
    tenant: { assertPermission: vi.fn(async () => {}), assertBranchAccess: vi.fn(async () => {}) },
    erp: { getProduct: vi.fn(async (id, org) => id === 7 && org === scope.organizationId ? product as any : null), getCustomer: vi.fn(async () => null) },
    catalog: { getCatalog: vi.fn(async (org) => ({ products: org === scope.organizationId ? [{ id: 7, name: product.name, sku: product.sku, unit: product.unit, brandName: "Popular" }] : [], customers: org === scope.organizationId ? [{ id: 1, name: "Alice" }] : [], vendors: org === scope.organizationId ? [{ id: 2, name: "Supply Co" }] : [], warehouses: [], rateLists: [{ id: 4, name: "Popular", code: "POP", priceType: "SALE" as const, scopeType: "GLOBAL" as const, currencyCode: "PKR" }] })) },
    pricing: { resolvePrice: vi.fn(async () => ({ product_id: 7, rate_list_id: 4, rate_list_version_id: 10, rate_list_item_id: 12, unit_price: 100, unit: "pcs", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL" as const, effective_from: "2026-01-01T00:00:00Z" })) },
    rateLists: { listActiveSaleRateLists: vi.fn(async () => [{ id: 4, organization_id: scope.organizationId, name: "Popular", code: "POP", price_type: "SALE" as const, scope_type: "GLOBAL" as const, vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }]), getVersion: vi.fn(async () => ({ id: 10, rate_list_id: 4, version_number: 2, status: "ACTIVE" as const, effective_from: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" })) },
  };
}
const call = (name: string, args: unknown, id = "call-1") => ({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
const step = (...output: ModelStep["output"]): ModelStep => ({ output, text: "" });
const final = (text: string): ModelStep => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], text });
function sequence(...steps: ModelStep[]) {
  const respond = vi.fn<AgentModel["respond"]>(async () => steps.shift() ?? final("done"));
  return { model: { respond } satisfies AgentModel, respond };
}

describe("read-only ERP agent", () => {
  it("loads six valid native tool definitions and rejects invalid schemas", async () => {
    const registry = new ErpToolRegistry(services());
    expect(ERP_TOOLS).toHaveLength(6);
    expect(new Set(registry.definitions().map((tool) => tool.name)).size).toBe(6);
    expect(registry.definitions().every((tool) => tool.type === "function" && tool.parameters.type === "object")).toBe(true);
    expect(ERP_TOOLS.every((tool) => tool.classification === "read" && tool.authentication === "required")).toBe(true);
    expect(await registry.execute("search_products", { query: "Popular 25mm", limit: 10 }, scope)).toMatchObject({ items: [expect.objectContaining({ id: 7 })] });
    await expect(registry.execute("lookup_product", { product_id: "7" }, scope)).rejects.toMatchObject({ code: "INVALID_COPILOT_TOOL_INPUT" });
    await expect(registry.execute("unknown", {}, scope)).rejects.toMatchObject({ code: "UNKNOWN_COPILOT_TOOL" });
  });

  it("lets the model select tools, use a first result for a second call, and finish", async () => {
    const deps = services();
    const { model, respond } = sequence(step(call("search_products", { query: "25mm", limit: 10 })), step(call("lookup_current_sale_rate", { product_id: 7, rate_list_id: 4, quantity: 1 }, "call-2")), final("PKR 100 per pcs"));
    const answer = await new ReadOnlyCopilotAgent(model, new ErpToolRegistry(deps)).run({ message: "Popular 25mm rate?" }, scope);
    expect(answer).toMatchObject({ answer: "PKR 100 per pcs", status: "completed" });
    expect(respond).toHaveBeenCalledTimes(3);
    expect(respond.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([expect.objectContaining({ type: "function", name: "lookup_current_sale_rate" })]));
    expect(JSON.stringify(respond.mock.calls[1]?.[0])).toContain("25mm PN20 pipe");
    expect(JSON.stringify(respond.mock.calls[2]?.[0])).toContain("unit_price");
    expect(deps.pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ organization_id: scope.organizationId, product_id: 7, rate_list_id: 4 }));
  });

  it("passes signed bounded context to a follow-up and rejects another branch", async () => {
    const registry = new ErpToolRegistry(services());
    const first = await new ReadOnlyCopilotAgent(sequence(step(call("lookup_current_sale_rate", { product_id: 7, quantity: 1 })), final("Popular PN20 is PKR 100")).model, registry).run({ message: "Popular 25mm PN20 rate?" }, scope);
    const { model, respond } = sequence(step(call("search_products", { query: "Dura", limit: 10 })), final("Dura PN20 is unavailable"));
    await new ReadOnlyCopilotAgent(model, registry).run({ message: "And Dura?", conversationToken: first.conversationToken }, scope);
    expect(JSON.stringify(respond.mock.calls[0]?.[0])).toContain("Popular 25mm PN20 rate?");
    expect(readConversation(first.conversationToken, { ...scope, branchId: "44444444-4444-4444-8444-444444444444" })).toEqual([]);
    expect(readConversation(`${first.conversationToken}tampered`, scope)).toEqual([]);
  });

  it("enforces authentication, organization, branch, permission, and reference ownership per tool", async () => {
    const deps = services(); const registry = new ErpToolRegistry(deps);
    await expect(registry.execute("lookup_product", { product_id: 7 }, { ...scope, userId: "" })).rejects.toMatchObject({ status: 401 });
    expect(await registry.execute("lookup_product", { product_id: 7 }, { ...scope, organizationId: "55555555-5555-4555-8555-555555555555" })).toBeNull();
    expect(await registry.execute("lookup_customers", { query: "Alice", limit: 10 }, { ...scope, organizationId: "55555555-5555-4555-8555-555555555555" })).toMatchObject({ items: [] });
    expect(await registry.execute("lookup_vendors", { query: "Supply", limit: 10 }, { ...scope, organizationId: "55555555-5555-4555-8555-555555555555" })).toMatchObject({ items: [] });
    await expect(registry.execute("lookup_current_sale_rate", { product_id: 999, quantity: 1 }, scope)).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(registry.execute("lookup_current_sale_rate", { product_id: 7, rate_list_id: 999, quantity: 1 }, scope)).rejects.toMatchObject({ code: "RATE_LIST_ACCESS_DENIED" });
    expect(deps.tenant.assertBranchAccess).toHaveBeenCalledWith({ userId: scope.userId, organizationId: scope.organizationId }, scope.branchId);
    vi.mocked(deps.tenant.assertPermission).mockRejectedValueOnce(new ApiError(403, "PERMISSION_DENIED", "denied"));
    await expect(registry.execute("lookup_vendors", { query: "Supply", limit: 10 }, scope)).rejects.toMatchObject({ status: 403 });
    vi.mocked(deps.tenant.assertBranchAccess).mockRejectedValueOnce(new ApiError(403, "BRANCH_ACCESS_DENIED", "denied"));
    await expect(registry.execute("lookup_customers", { query: "Alice", limit: 10 }, scope)).rejects.toMatchObject({ status: 403 });
    expect(await registry.execute("search_rate_lists", { query: "Popular", limit: 10 }, scope)).toEqual([expect.objectContaining({ id: 4 })]);
  });

  it("stops repeated calls, malformed calls, iteration exhaustion, and timeouts", async () => {
    const registry = new ErpToolRegistry(services());
    const repeated = sequence(step(call("search_products", { query: "25mm", limit: 10 })), step(call("search_products", { query: "25mm", limit: 10 }, "call-2")));
    expect((await new ReadOnlyCopilotAgent(repeated.model, registry).run({ message: "x" }, scope)).status).toBe("duplicate");
    const malformed = sequence(step({ type: "function_call", call_id: "c", name: "search_products", arguments: "{" }));
    expect((await new ReadOnlyCopilotAgent(malformed.model, registry).run({ message: "x" }, scope)).status).toBe("malformed");
    const overLimit = sequence(step(...Array.from({ length: 13 }, (_, index) => call("search_products", { query: String(index), limit: 1 }, String(index)))));
    expect((await new ReadOnlyCopilotAgent(overLimit.model, registry).run({ message: "x" }, scope)).status).toBe("call_limit");
    const endless: AgentModel = { respond: async (_input, _tools) => step(call("search_products", { query: String(Math.random()), limit: 1 }, String(Math.random()))) };
    expect((await new ReadOnlyCopilotAgent(endless, registry).run({ message: "x" }, scope)).status).toBe("limit");
    const hung: AgentModel = { respond: () => new Promise(() => {}) };
    expect((await new ReadOnlyCopilotAgent(hung, registry, 5).run({ message: "x" }, scope)).status).toBe("timeout");
    expect((await new ReadOnlyCopilotAgent(sequence(final("Unverified price")).model, registry).run({ message: "x" }, scope)).status).toBe("empty");
    const failed: AgentModel = { respond: async () => { throw new Error("provider unavailable"); } };
    expect((await new ReadOnlyCopilotAgent(failed, registry).run({ message: "x" }, scope)).status).toBe("error");
  });

  it("does not begin another ERP call after a tool exceeds the deadline", async () => {
    const deps = services();
    vi.mocked(deps.catalog.getCatalog).mockImplementation(() => new Promise(() => {}));
    const { model } = sequence(step(call("search_products", { query: "pipe" }), call("lookup_product", { product_id: 7 }, "second")));
    const result = await new ReadOnlyCopilotAgent(model, new ErpToolRegistry(deps), 5).run({ message: "Pipe" }, scope);
    expect(result.status).toBe("timeout");
    expect(deps.erp.getProduct).not.toHaveBeenCalled();
  });

  it("returns verified missing product and missing rate results without using product sale_price", async () => {
    const deps = services();
    const registry = new ErpToolRegistry(deps);
    const missing = await new ReadOnlyCopilotAgent(sequence(step(call("search_products", { query: "ABC XYZ 9999" })), final("No matching ERP product is available.")).model, registry).run({ message: "ABC XYZ 9999" }, scope);
    expect(missing).toMatchObject({ status: "completed", answer: "No matching ERP product is available." });
    vi.mocked(deps.pricing.resolvePrice).mockResolvedValueOnce(null);
    const rate = await new ReadOnlyCopilotAgent(sequence(step(call("lookup_current_sale_rate", { product_id: 7 })), final("No authorized current sale rate is available.")).model, registry).run({ message: "Current rate" }, scope);
    expect(rate).toMatchObject({ status: "completed", answer: "No authorized current sale rate is available." });
    expect(rate.answer).not.toContain(String(product.sale_price));
  });

  it("feeds tool failures back to the model and permits a different authorized recovery call", async () => {
    const deps = services();
    vi.mocked(deps.catalog.getCatalog).mockRejectedValueOnce(new Error("unavailable"));
    const { model, respond } = sequence(step(call("search_products", { query: "pipe" })), step(call("lookup_product", { product_id: 7 }, "recovery")), final("Verified pipe"));
    const result = await new ReadOnlyCopilotAgent(model, new ErpToolRegistry(deps)).run({ message: "Pipe" }, scope);
    expect(result).toMatchObject({ status: "completed", answer: "Verified pipe" });
    expect(JSON.stringify(respond.mock.calls[1]?.[0])).toContain("Tool result unavailable");
  });
});
