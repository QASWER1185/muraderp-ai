import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import type { PermissionCode } from "../../auth/authorization.types.js";
import type { TenantAccessService } from "../../auth/tenant-access.service.js";
import type { ErpService } from "../../services/erp.service.js";
import type { PricingService } from "../../services/pricing.service.js";
import type { RateListRepository } from "../../repositories/rate-list.repository.js";
import type { CopilotCatalogRepository } from "../copilot-review.js";

export type AgentScope = { userId: string; organizationId: string; branchId: string };
export type ToolServices = {
  tenant: Pick<TenantAccessService, "assertPermission" | "assertBranchAccess">;
  erp: Pick<ErpService, "getProduct" | "getCustomer">;
  catalog: Pick<CopilotCatalogRepository, "getCatalog">;
  pricing: Pick<PricingService, "resolvePrice">;
  rateLists: Pick<RateListRepository, "listActiveSaleRateLists">;
};
export type ErpTool<T extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: T;
  permission: PermissionCode;
  authentication: "required";
  scope: "organization_and_branch";
  classification: "read";
  execute: (input: z.output<T>, scope: AgentScope, services: ToolServices) => Promise<unknown>;
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
  defineTool({ name: "search_products", description: "Find products by name, SKU, or brand. Returns candidate IDs; use lookup and price tools to verify details.", schema: lookup, permission: "products.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { catalog }) => {
    const rows = await catalog.getCatalog(scope.organizationId);
    const terms = query.toLocaleLowerCase().split(/\s+/);
    return { items: rows.products.filter((p) => { const text = `${p.name} ${p.sku} ${p.brandName ?? ""}`.toLocaleLowerCase(); return terms.every((term) => text.includes(term)); }).slice(0, limit), catalogLimitReached: rows.products.length >= 5000 };
  } }),
  defineTool({ name: "lookup_product", description: "Get one product by ID after finding it. Does not return purchase cost or an authoritative sale rate.", schema: productId, permission: "products.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ product_id }, scope, { erp, catalog }) => {
    const product = await erp.getProduct(product_id, scope.organizationId);
    if (!product) return null;
    const { products } = await catalog.getCatalog(scope.organizationId);
    return { id: product.id, name: product.name, sku: product.sku, category: product.category, unit: product.unit, brandName: products.find((p) => p.id === product.id)?.brandName ?? null };
  } }),
  defineTool({ name: "search_rate_lists", description: "Find active organization sale rate lists by name or code.", schema: lookup, permission: "sales.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { rateLists }) => {
    const rows = await rateLists.listActiveSaleRateLists(scope.organizationId);
    return rows.filter((r) => [r.name, r.code].some((v) => match(v, query))).slice(0, limit).map((r) => ({ id: r.id, name: r.name, code: r.code, scopeType: r.scope_type, customerId: r.customer_id, currencyCode: r.currency_code }));
  } }),
  defineTool({ name: "lookup_current_sale_rate", description: "Resolve the authorized active sale rate for a product and optional rate list, customer, and quantity. Never infer a rate from product fields.", schema: priceInput, permission: "sales.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ product_id, rate_list_id, customer_id, quantity }, scope, { erp, rateLists, pricing, tenant }) => {
    const product = await erp.getProduct(product_id, scope.organizationId);
    if (!product) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product is not available in this organization");
    if (customer_id !== undefined) {
      await tenant.assertPermission({ userId: scope.userId, organizationId: scope.organizationId }, "customers.read");
      if (!await erp.getCustomer(customer_id, scope.organizationId)) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Customer is not available in this organization");
    }
    if (rate_list_id !== undefined) {
      const lists = await rateLists.listActiveSaleRateLists(scope.organizationId);
      const list = lists.find((r) => r.id === rate_list_id);
      if (!list || (list.scope_type === "CUSTOMER" && list.customer_id !== customer_id) || list.scope_type === "VENDOR") {
        throw new ApiError(403, "RATE_LIST_ACCESS_DENIED", "Sale rate list is not applicable to this request");
      }
    }
    return pricing.resolvePrice({ organization_id: scope.organizationId, price_type: "SALE", product_id, quantity, as_of: new Date().toISOString(), ...(rate_list_id === undefined ? {} : { rate_list_id }), ...(customer_id === undefined ? {} : { customer_id }) });
  } }),
  defineTool({ name: "lookup_customers", description: "Find customers by name in the current organization.", schema: lookup, permission: "customers.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { catalog }) => { const rows = (await catalog.getCatalog(scope.organizationId)).customers; return { items: rows.filter((c) => match(c.name, query)).slice(0, limit), catalogLimitReached: rows.length >= 5000 }; } }),
  defineTool({ name: "lookup_vendors", description: "Find vendors by name in the current organization.", schema: lookup, permission: "vendors.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit }, scope, { catalog }) => { const rows = (await catalog.getCatalog(scope.organizationId)).vendors; return { items: rows.filter((v) => match(v.name, query)).slice(0, limit), catalogLimitReached: rows.length >= 5000 }; } }),
] as const;

export class ErpToolRegistry {
  private readonly tools = new Map<string, ErpTool>(ERP_TOOLS.map((tool) => [tool.name, tool]));
  constructor(private readonly services: ToolServices) {}
  definitions() { return [...this.tools.values()].map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, strict: false, parameters: z.toJSONSchema(tool.schema) })); }
  async execute(name: string, raw: unknown, scope: AgentScope): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new ApiError(400, "UNKNOWN_COPILOT_TOOL", "Requested Copilot tool is unavailable");
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and tenant context are required");
    await this.services.tenant.assertPermission({ userId: scope.userId, organizationId: scope.organizationId }, tool.permission);
    await this.services.tenant.assertBranchAccess({ userId: scope.userId, organizationId: scope.organizationId }, scope.branchId);
    const input = tool.schema.safeParse(raw);
    if (!input.success) throw new ApiError(400, "INVALID_COPILOT_TOOL_INPUT", "Copilot tool arguments are invalid");
    return tool.execute(input.data, scope, this.services);
  }
}
