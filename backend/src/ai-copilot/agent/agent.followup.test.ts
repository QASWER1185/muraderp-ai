import { resolveCandidates } from "../../services/entity-search.service.js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseRateListRepository } from "../../repositories/rate-list.repository.js";
import { DefaultPricingService } from "../../services/pricing.service.js";
import type { ResolvedPrice } from "../../types/pricing.types.js";
import { ReadOnlyCopilotAgent } from "./agent.js";
import { readConversation } from "./conversation.js";
import { ErpToolRegistry, type AgentScope, type ToolServices } from "./erp-tools.js";
import type { AgentModel, ModelStep } from "./model.js";

const scope: AgentScope = { userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
const product = { id: 26, name: "POPULAR PPR-100 PIPE PN-20 25MM", sku: "POPULARPPR-100PIPEPN-2025MM", unit: "MTR", category: "Pipe", brand_id: null, sale_price: 0, purchase_price: 0 };
const activeRateFixture = {
  rate_lists: [{ id: 3, organization_id: scope.organizationId, name: "POPULAR SALE", code: "POPULAR", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true }],
  rate_list_versions: [{ id: 40, rate_list_id: 3, version_number: 4, status: "ACTIVE", effective_from: "2026-01-01T00:00:00Z", effective_to: null }],
  rate_list_items: [{ id: 9, rate_list_version_id: 40, product_id: 26, minimum_quantity: 1, unit_price: 477, unit: "MTR" }],
};
const toolCall = (name: string, args: unknown, callId: string): ModelStep => ({ output: [{ type: "function_call", name, arguments: JSON.stringify(args), call_id: callId }], text: "" });
const answer = (text: string): ModelStep => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], text });

function setup(products = [product]) {
  const queried = vi.fn((table: keyof typeof activeRateFixture) => {
    let rows: Array<Record<string, unknown>> = [...activeRateFixture[table]];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
      lte: (key: string, value: number) => { rows = rows.filter((row) => Number(row[key]) <= value); return query; },
      order: () => query,
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: { data: typeof rows; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  });
  const rateLists = new SupabaseRateListRepository(() => ({ from: queried }) as any);
  const findBestRateListItem = vi.spyOn(rateLists, "findBestRateListItem");
  const pricing = new DefaultPricingService(rateLists);
  const resolvePrice = vi.spyOn(pricing, "resolvePrice");
  const services: ToolServices = {
    tenant: { assertPermission: vi.fn(async () => {}), assertBranchAccess: vi.fn(async () => {}) },
    erp: { getProduct: vi.fn(async (id, organizationId) => organizationId === scope.organizationId && id === 26 ? product as any : null), getCustomer: vi.fn(async () => null) },
    catalog: { getCatalog: vi.fn(async (organizationId) => ({ products: organizationId === scope.organizationId ? products.map(({ id, name, sku, unit }) => ({ id, name, sku, unit })) : [], customers: [], vendors: [], warehouses: [], rateLists: [] })) },
    search: {
      searchProducts: vi.fn(async (query: string, limit: number, tenant: AgentScope) => resolveCandidates(tenant.organizationId === scope.organizationId ? products.filter(p => query.toLowerCase().split(/\s+/).every(t => p.name.toLowerCase().includes(t))).map(p => ({id:p.id,name:p.name,sku:p.sku,unit:p.unit,category:p.category,brandName:null,confidence:0.95,match_kind:"fuzzy"})) : [],limit)),
      searchCustomers: vi.fn(async () => resolveCandidates([],10)),
      getProductBrand: vi.fn(async () => null),
    },
    pricing,
    rateLists,
  };
  return { registry: new ErpToolRegistry(services), resolvePrice, findBestRateListItem, queried };
}

function firstTurnModel(query = "Popular PPR-100 25MM PN-20"): AgentModel {
  return { respond: async (input) => JSON.stringify(input).includes("function_call_output")
    ? answer(`${product.name} (Product ID ${product.id})`)
    : toolCall("search_products", { query, limit: 10 }, "search") };
}

function priorProducts(input: unknown[]): Array<{ id: number; unit: string }> {
  const context = input.find((item) => typeof item === "object" && item !== null && "content" in item && typeof item.content === "string" && item.content.startsWith("Verified product context:")) as { content: string } | undefined;
  return context ? JSON.parse(context.content.slice("Verified product context:".length)).candidates : [];
}

function followupModel(quantity: number): AgentModel {
  return { respond: async (input, tools) => {
    expect(tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "lookup_current_sale_rate" })]));
    const output = input.findLast((item) => typeof item === "object" && item !== null && "type" in item && item.type === "function_call_output") as { output: string } | undefined;
    if (output) {
      const rate = JSON.parse(output.output) as ResolvedPrice & { rate_list_version_number: number };
      return answer(`${rate.currency_code} ${rate.unit_price}/${rate.unit} · Version #${rate.rate_list_version_number} · total PKR ${rate.unit_price * quantity}`);
    }
    const candidates = priorProducts(input);
    if (candidates.length !== 1) return answer("Which product do you mean?");
    return toolCall("lookup_current_sale_rate", { product_id: candidates[0]!.id, quantity }, "price");
  } };
}

describe("verified product context for follow-up pricing", () => {
  it.each([
    ["What's its current sale price? Quantity 1 meter.", 1, 477],
    ["What is the total price for 5 meters?", 5, 2385],
    ["What's its rate?", 1, 477],
  ])("uses the active rate resolver after %s", async (question, quantity, total) => {
    const { registry, resolvePrice, findBestRateListItem } = setup();
    const first = await new ReadOnlyCopilotAgent(firstTurnModel(), registry).run({ message: "Popular PPR-100 25MM PN-20" }, scope);
    expect(first.status).toBe("completed");
    const second = await new ReadOnlyCopilotAgent(followupModel(quantity), registry).run({ message: question, conversationToken: first.conversationToken }, scope);
    expect(second).toMatchObject({ status: "completed" });
    expect(second.answer).toContain("PKR 477/MTR");
    expect(second.answer).toContain("Version #4");
    expect(second.answer).toContain(`total PKR ${total}`);
    expect(resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ organization_id: scope.organizationId, product_id: 26, price_type: "SALE", quantity }));
    expect(findBestRateListItem).toHaveBeenCalledOnce();
    expect(findBestRateListItem).toHaveReturnedWith(expect.any(Promise));
  });

  it("does not carry product evidence across user, organization, or branch", async () => {
    const { registry, resolvePrice } = setup();
    const first = await new ReadOnlyCopilotAgent(firstTurnModel(), registry).run({ message: "Popular PPR-100 25MM PN-20" }, scope);
    expect(readConversation(first.conversationToken, scope).at(-1)?.productContext?.candidates).toEqual([expect.objectContaining({ id: 26, unit: "MTR" })]);
    for (const changed of [
      { ...scope, userId: "44444444-4444-4444-8444-444444444444" },
      { ...scope, organizationId: "55555555-5555-4555-8555-555555555555" },
      { ...scope, branchId: "66666666-6666-4666-8666-666666666666" },
    ]) {
      expect(readConversation(first.conversationToken, changed)).toEqual([]);
      const followup = await new ReadOnlyCopilotAgent(followupModel(1), registry).run({ message: "What's its rate?", conversationToken: first.conversationToken }, changed);
      expect(followup.status).not.toBe("completed");
    }
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it("requires a tool after an initial unverified follow-up answer", async () => {
    const { registry, resolvePrice } = setup();
    const first = await new ReadOnlyCopilotAgent(firstTurnModel(), registry).run({ message: "Popular PPR-100 25MM PN-20" }, scope);
    const choices: Array<string | undefined> = [];
    const model: AgentModel = { respond: async (input, _tools, _signal, options) => {
      choices.push(options?.toolChoice);
      if (choices.length === 1) return answer("I can search products and rates.");
      const output = input.findLast((item) => typeof item === "object" && item !== null && "type" in item && item.type === "function_call_output") as { output: string } | undefined;
      if (output) {
        const rate = JSON.parse(output.output) as ResolvedPrice & { rate_list_version_number: number };
        return answer(`${rate.currency_code} ${rate.unit_price}/${rate.unit} · Version #${rate.rate_list_version_number}`);
      }
      return toolCall("lookup_current_sale_rate", { product_id: priorProducts(input)[0]?.id, quantity: 1 }, "price");
    } };
    const second = await new ReadOnlyCopilotAgent(model, registry).run({ message: "What's its current sale price? Quantity 1 meter.", conversationToken: first.conversationToken }, scope);
    expect(choices).toEqual(["auto", "required", "auto"]);
    expect(second).toMatchObject({ status: "completed" });
    expect(second.answer).toContain("PKR 477/MTR · Version #4");
    expect(resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ product_id: 26, quantity: 1 }));
  });

  it("asks for clarification when prior product candidates are ambiguous", async () => {
    const other = { ...product, id: 27, name: "POPULAR PPR-100 PIPE PN-16 25MM", sku: "POPULARPPR-100PIPEPN-1625MM" };
    const { registry, resolvePrice } = setup([product, other]);
    const first = await new ReadOnlyCopilotAgent(firstTurnModel("Popular 25MM"), registry).run({ message: "Popular 25MM pipes" }, scope);
    const second = await new ReadOnlyCopilotAgent(followupModel(1), registry).run({ message: "What's its rate?", conversationToken: first.conversationToken }, scope);
    expect(second.answer).toMatch(/which product/i);
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it("blocks a guessed rate call when prior products are ambiguous", async () => {
    const other = { ...product, id: 27, name: "POPULAR PPR-100 PIPE PN-16 25MM", sku: "POPULARPPR-100PIPEPN-1625MM" };
    const { registry, resolvePrice } = setup([product, other]);
    const first = await new ReadOnlyCopilotAgent(firstTurnModel("Popular 25MM"), registry).run({ message: "Popular 25MM pipes" }, scope);
    const second = await new ReadOnlyCopilotAgent({ respond: async () => toolCall("lookup_current_sale_rate", { product_id: 26, quantity: 1 }, "guessed") }, registry)
      .run({ message: "What's its rate?", conversationToken: first.conversationToken }, scope);
    expect(second).toMatchObject({ status: "clarification" });
    expect(second.answer).toMatch(/which product/i);
    expect(resolvePrice).not.toHaveBeenCalled();
  });
});
