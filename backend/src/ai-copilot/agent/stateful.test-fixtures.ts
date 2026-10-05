import { vi } from "vitest";
import { resolveCandidates } from "../../services/entity-search.service.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { ErpToolRegistry, type ToolServices } from "./erp-tools.js";
import type { AgentModel, ModelStep } from "./model.js";

export const scope = { userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
export const pipe = { id: 26, name: "POPULAR PPR-100 PIPE PN-20 25MM", sku: "PIPE-26", unit: "MTR", brand_id: null };
export const elbow = { id: 27, name: "POPULAR FEMALE ELBOW 25MM", sku: "ELBOW-27", unit: "PCS", brand_id: null };
export const customer = { id: 19, name: "Qasim sahib" };
export function fixture() {
  const erpWrite = vi.fn();
  const services: ToolServices = {
    tenant: { assertPermission: vi.fn(async () => {}), assertBranchAccess: vi.fn(async () => {}) },
    erp: {
      getProduct: vi.fn(async (id, org) => org === scope.organizationId ? [pipe, elbow].find(p => p.id === id) as any ?? null : null),
      getCustomer: vi.fn(async (id, org) => org === scope.organizationId && id === customer.id ? customer as any : null),
      ...{ createEstimate: erpWrite },
    },
    catalog: { getCatalog: vi.fn(async () => { throw new Error("Conversational drafts must not load a full catalog"); }) },
    search: {
      searchProducts: vi.fn(async (query: string, limit: number) => resolveCandidates(
        [query.toLowerCase().includes("elbow") ? elbow : pipe].map(p => ({ ...p, category: "Pipe fittings", brandName: "Popular", confidence: .99, match_kind: "exact_name" })), limit)),
      searchCustomers: vi.fn(async (_query: string, limit: number) => resolveCandidates([{ ...customer, city: "Lahore", confidence: .99, match_kind: "exact_name" }], limit)),
      getProductBrand: vi.fn(async () => "Popular"),
    },
    pricing: { resolvePrice: vi.fn(async input => ({
      product_id: input.product_id, rate_list_id: 4, rate_list_version_id: 10, rate_list_item_id: input.product_id,
      unit_price: input.product_id === pipe.id ? 477 : 200, unit: input.product_id === pipe.id ? "MTR" : "PCS",
      currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL" as const, effective_from: "2026-01-01T00:00:00Z",
    })) },
    rateLists: {
      listActiveSaleRateLists: vi.fn(async () => [{ id: 4, organization_id: scope.organizationId, name: "Popular", code: "POP", price_type: "SALE", scope_type: "GLOBAL", vendor_id: null, customer_id: null, currency_code: "PKR", is_active: true }] as any),
      getVersion: vi.fn(async () => ({ id: 10, rate_list_id: 4, version_number: 1 }) as any),
    },
  };
  let steps: Array<ModelStep | ((input: unknown[]) => ModelStep)> = [];
  const respond = vi.fn<AgentModel["respond"]>(async input => {
    const next = steps.shift();
    return typeof next === "function" ? next(input) : next ?? final("Model attempted an invented total of 999999.");
  });
  const tools = new ErpToolRegistry(services, true);
  const core = new UnifiedCopilotAgent({ respond }, tools);
  const script = (...next: typeof steps) => { steps = next; };
  return { services, erpWrite, core, tools, respond, script };
}
export function call(name: string, args: unknown = {}, callId = name): ModelStep {
  return { output: [{ type: "function_call", call_id: callId, name, arguments: JSON.stringify(args) }], text: "" };
}
export function final(text: string): ModelStep {
  return { output: [{ type: "message", content: [{ type: "output_text", text }] }], text };
}
