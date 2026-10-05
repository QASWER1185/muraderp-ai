import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import type { PermissionCode } from "../../auth/authorization.types.js";
import type { TenantAccessService } from "../../auth/tenant-access.service.js";
import type { ErpService } from "../../services/erp.service.js";
import type { PricingService } from "../../services/pricing.service.js";
import type { RateListLifecycleRepository, RateListRepository } from "../../repositories/rate-list.repository.js";
import type { CopilotCatalogRepository } from "../copilot-review.js";
import type { EntitySearchService } from "../../services/entity-search.service.js";
import type { BusinessState } from "./business-state.js";
import { ConversationalDraftService, DRAFT_TOOL_DEFINITIONS } from "./draft-tools.js";

export type AgentScope = { userId: string; organizationId: string; branchId: string };
export type ToolServices = {
  tenant: Pick<TenantAccessService, "assertPermission" | "assertBranchAccess">;
  erp: Pick<ErpService, "getProduct" | "getCustomer">;
  catalog: Pick<CopilotCatalogRepository, "getCatalog">;
  search: EntitySearchService;
  pricing: Pick<PricingService, "resolvePrice">;
  rateLists: Pick<RateListRepository, "listActiveSaleRateLists"> & Pick<RateListLifecycleRepository, "getVersion">;
};
export type ErpTool<T extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: T;
  permission: PermissionCode;
  authentication: "required";
  scope: "organization_and_branch";
  classification: "read";
  execute: (input: z.output<T>, scope: AgentScope, services: ToolServices, signal?: AbortSignal) => Promise<unknown>;
};

const query = z.string().trim().min(1).max(120);
const id = z.number().int().positive();
const limit = z.number().int().min(1).max(20).default(10);
const lookup = z.strictObject({ query, limit });
const productId = z.strictObject({ product_id: id });
const priceInput = z.strictObject({ product_id: id, rate_list_id: id.optional(), customer_id: id.optional(), quantity: z.number().finite().positive().default(1) });
const match = (value: string, term: string) => value.toLocaleLowerCase().includes(term.toLocaleLowerCase());

function defineTool<T extends z.ZodType>(tool: ErpTool<T>): ErpTool<T> { return tool; }

export const ERP_TOOLS = [
  defineTool({ name: "search_products", description: "Search ERP products with typo-tolerant database matching by name, SKU, brand, category, dimensions, PN rating or unit. Returns ranked candidates and resolution. Use bestCandidate only when resolved; otherwise ask for clarification.", schema: lookup, permission: "products.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { search }) => {
    return search.searchProducts(query, limit, scope);
  } }),
  defineTool({ name: "lookup_product", description: "Get one product by ID after finding it. Does not return purchase cost or an authoritative sale rate.", schema: productId, permission: "products.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ product_id }, scope, { erp, search }) => {
    const product = await erp.getProduct(product_id, scope.organizationId);
    if (!product) return null;
    return { id: product.id, name: product.name, sku: product.sku, category: product.category, unit: product.unit, brandName: product.brand_id == null ? null : await search.getProductBrand(product.brand_id, scope.organizationId) };
  } }),
  defineTool({ name: "search_rate_lists", description: "Find active organization sale rate lists by name or code.", schema: lookup, permission: "sales.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { rateLists }) => {
    const rows = await rateLists.listActiveSaleRateLists(scope.organizationId);
    return rows.filter((r) => [r.name, r.code].some((v) => match(v, query))).slice(0, limit).map((r) => ({ id: r.id, name: r.name, code: r.code, scopeType: r.scope_type, customerId: r.customer_id, currencyCode: r.currency_code }));
  } }),
  defineTool({ name: "lookup_current_sale_rate", description: "Resolve the authorized active sale rate for a product and optional rate list, customer, and quantity. Never infer a rate from product fields.", schema: priceInput, permission: "sales.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ product_id, rate_list_id, customer_id, quantity }, scope, { erp, rateLists, pricing, tenant }, signal) => {
    const product = await erp.getProduct(product_id, scope.organizationId);
    signal?.throwIfAborted();
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product is not available in this organization");
    if (customer_id !== undefined) {
      await tenant.assertPermission({ userId: scope.userId, organizationId: scope.organizationId }, "customers.read");
      signal?.throwIfAborted();
      if (!await erp.getCustomer(customer_id, scope.organizationId)) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Customer is not available in this organization");
      signal?.throwIfAborted();
    }
    if (rate_list_id !== undefined) {
      const lists = await rateLists.listActiveSaleRateLists(scope.organizationId);
      signal?.throwIfAborted();
      const list = lists.find((r) => r.id === rate_list_id);
      if (!list || (list.scope_type === "CUSTOMER" && list.customer_id !== customer_id) || list.scope_type === "VENDOR") {
        throw new ApiError(403, "RATE_LIST_ACCESS_DENIED", "Sale rate list is not applicable to this request");
      }
    }
    const resolved = await pricing.resolvePrice({ organization_id: scope.organizationId, price_type: "SALE", product_id, quantity, as_of: new Date().toISOString(), ...(rate_list_id === undefined ? {} : { rate_list_id }), ...(customer_id === undefined ? {} : { customer_id }) });
    signal?.throwIfAborted();
    if (!resolved) return null;
    const version = await rateLists.getVersion(resolved.rate_list_version_id);
    if (version.rate_list_id !== resolved.rate_list_id) throw new Error("Resolved rate-list version does not match its rate list");
    return { ...resolved, rate_list_version_number: version.version_number };
  } }),
  defineTool({ name: "lookup_customers", description: "Search customers by imperfect name, city/address available in ERP, or exact phone. Supports honorifics and conservative Urdu/Latin matching. Returns ranked candidates; only resolved bestCandidate may be selected. Ask for clarification otherwise.", schema: lookup, permission: "customers.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { search }) => search.searchCustomers(query, limit, scope) }),
  defineTool({ name: "lookup_vendors", description: "Find vendors by name in the current organization.", schema: lookup, permission: "vendors.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { catalog }) => { const rows = (await catalog.getCatalog(scope.organizationId)).vendors; return { items: rows.filter((v) => match(v.name, query)).slice(0, limit), catalogLimitReached: rows.length >= 5000 }; } }),
] as const;

export class ErpToolRegistry {
  private readonly tools = new Map<string, ErpTool>(ERP_TOOLS.map((tool) => [tool.name, tool]));
  readonly drafts: ConversationalDraftService;
  constructor(private readonly services: ToolServices, private readonly conversationalDrafts = false) {
    this.drafts = new ConversationalDraftService(services, (input, scope, signal) => this.execute("lookup_current_sale_rate", input, scope, undefined, undefined, signal));
  }
  async assertScope(scope: AgentScope) {
    await this.services.tenant.assertBranchAccess(scope, scope.branchId);
  }
  definitions() {
    const reads = [...this.tools.values()].map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, strict: false, parameters: z.toJSONSchema(tool.schema) }));
    return this.conversationalDrafts ? [...reads, ...DRAFT_TOOL_DEFINITIONS] : reads;
  }
  async execute(name: string, raw: unknown, scope: AgentScope, state?: BusinessState, _originalMessage?: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if (this.conversationalDrafts && this.drafts.handles(name)) {
      if (!state) throw new ApiError(400, "CONVERSATION_CONTEXT_REQUIRED", "Validated conversation state is required.");
      return this.drafts.execute(name, raw, scope, state, signal);
    }
    const tool = this.tools.get(name);
    if (!tool) throw new ApiError(400, "UNKNOWN_COPILOT_TOOL", "Requested Copilot tool is unavailable");
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and tenant context are required");
    await this.services.tenant.assertPermission({ userId: scope.userId, organizationId: scope.organizationId }, tool.permission);
    signal?.throwIfAborted();
    await this.services.tenant.assertBranchAccess({ userId: scope.userId, organizationId: scope.organizationId }, scope.branchId);
    signal?.throwIfAborted();
    const input = tool.schema.safeParse(raw);
    if (!input.success) throw new ApiError(400, "INVALID_COPILOT_TOOL_INPUT", "Copilot tool arguments are invalid");
    return tool.execute(input.data, scope, this.services, signal);
  }
}
