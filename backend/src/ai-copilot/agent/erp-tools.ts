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
import { touchDraft } from "./business-state.js";
import { BusinessIntelligenceTools, BUSINESS_TOOL_DEFINITIONS, type BusinessServices } from "./business-tools.js";
import type { CopilotRuntime } from "../copilot.runtime.js";
import { randomUUID } from "node:crypto";
import { ERP_ACTION_DEFINITIONS, ERP_ACTION_SCHEMAS, ERP_ACTION_PERMISSIONS, ERP_READ_ACTIONS, isErpActionName, type ErpReadName, type ErpWriteName } from "../tools/registry.js";
import type { CustomerMemory } from "../customerMemoryStore.js";
import { explicitBrand,brandsInText } from "../productResolver.js";

export type AgentScope = { userId: string; organizationId: string; branchId: string };
export type ToolServices = {
  memory?: CustomerMemory;
  tenant: Pick<TenantAccessService, "assertPermission" | "assertBranchAccess">;
  erp: Pick<ErpService, "getProduct" | "getCustomer">;
  catalog: Pick<CopilotCatalogRepository, "getCatalog">;
  search: EntitySearchService;
  pricing: Pick<PricingService, "resolvePrice">;
  rateLists: Pick<RateListRepository, "listActiveSaleRateLists"> & Pick<RateListLifecycleRepository, "getVersion">;
  runtime?: Pick<CopilotRuntime, "createMasterDataDraft"> & Partial<Pick<CopilotRuntime,"createUnifiedDraft"|"getBusinessReport"|"getDepotReport"|"confirmAndExecute">>;
};
export type ErpTool<T extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  schema: T;
  permission: PermissionCode;
  authentication: "required";
  scope: "organization_and_branch";
  classification: "read" | "prepare";
  execute: (input: z.output<T>, scope: AgentScope, services: ToolServices, signal?: AbortSignal) => Promise<unknown>;
};

const query = z.string().trim().min(1).max(120);
const id = z.number().int().positive();
const limit = z.number().int().min(1).max(20).default(10);
const lookup = z.strictObject({ query, limit });
const productId = z.strictObject({ product_id: id });
const priceInput = z.strictObject({ product_id: id, rate_list_id: id.optional(), customer_id: id.optional(), quantity: z.number().finite().positive().default(1) });
const customerCreateSchema = z.strictObject({ name: z.string().trim().min(1).max(200), phone: z.string().trim().min(1).max(50), city: z.string().trim().min(1).max(120) });
const match = (value: string, term: string) => value.toLocaleLowerCase().includes(term.toLocaleLowerCase());

function defineTool<T extends z.ZodType>(tool: ErpTool<T>): ErpTool<T> { return tool; }

const CUSTOMER_CREATE_TOOL = defineTool({ name: "prepare_customer_create", description: "Prepare a NEW customer for review after collecting name, phone as a string preserving leading zeros, and city/address. Never invent missing fields. This creates only an approval draft; the user must explicitly confirm before any customer is created.", schema: customerCreateSchema, permission: "customers.write", authentication: "required", scope: "organization_and_branch", classification: "prepare", execute: async (input, scope, { runtime }, signal) => {
    if (!runtime) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Customer draft preparation is unavailable.");
    signal?.throwIfAborted();
    const idempotencyKey = `copilot-customer-${randomUUID()}`;
    const draft = await runtime.createMasterDataDraft({ ...scope, source: "text", intent: "customer_create", ...input }, idempotencyKey);
    return { review: { intent: "customer_create", draftId: draft.id, idempotencyKey, ...input, requiresConfirmation: true } };
  } });

export const ERP_TOOLS = [
  defineTool({name:"recall_customer_memory",description:"Recall preferred brands by category, dated authorized historical discounts and purchasing patterns for a resolved customer. Current rates and merchant cost floors still apply.",schema:z.strictObject({customer_id:id}),permission:"customers.read",authentication:"required",scope:"organization_and_branch",classification:"read",execute:async({customer_id},scope,{memory,erp,tenant})=>{
    await tenant.assertPermission(scope,"sales.read");
    const customer=await erp.getCustomer(customer_id,scope.organizationId);
    if(!customer)throw new ApiError(404,"CUSTOMER_NOT_FOUND","Customer is unavailable.");
    if(!memory)throw new ApiError(503,"CUSTOMER_MEMORY_UNAVAILABLE","Customer memory is not configured.");
    const profile=await memory.recall(scope,customer.id,customer.name);
    // A bounded model context; complete history remains available to the server.
    return {...profile,history:profile.history.slice(0,30)};
  }}),
  defineTool({ name: "search_products", description: "Search products by name, dimensions and brand. An explicit brand is a HARD filter against active sale catalog items; never substitute another brand. Use bestCandidate only when resolved.", schema:lookup.extend({brand:query.optional()}), permission: "products.read", authentication: "required", scope: "organization_and_branch", classification: "read", execute: async ({ query, limit, brand }, scope, { search }) => {
    return brand ? search.searchProducts(query,limit,scope,brand) : search.searchProducts(query, limit, scope);
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
  readonly business?: BusinessIntelligenceTools;
  constructor(private readonly services: ToolServices, private readonly conversationalDrafts = false, businessServices?: BusinessServices) {
    if (services.runtime) this.tools.set(CUSTOMER_CREATE_TOOL.name, CUSTOMER_CREATE_TOOL);
    this.drafts = new ConversationalDraftService(services, (input, scope, signal) => this.execute("lookup_current_sale_rate", input, scope, undefined, undefined, signal));
    if (businessServices) this.business = new BusinessIntelligenceTools(services, businessServices);
  }
  async assertScope(scope: AgentScope) {
    await this.services.tenant.assertBranchAccess(scope, scope.branchId);
  }
  async applySelection(selection:{kind:"product"|"customer"|"vendor";id:number},scope:AgentScope,state:BusinessState) {
    if (state.userId!==scope.userId || state.organizationId!==scope.organizationId || state.branchId!==scope.branchId ||
      state.clarification?.kind!==selection.kind || !state.clarification.candidates.some(row=>row.id===selection.id)) {
      throw new ApiError(422,"INVALID_ENTITY_SELECTION","Choose a candidate from the current conversation.");
    }
    await this.assertScope(scope);
    await this.services.tenant.assertPermission(scope,selection.kind==="product"?"products.read":selection.kind==="customer"?"customers.read":"vendors.read");
    if(selection.kind==="product") {
      const product=await this.services.erp.getProduct(selection.id,scope.organizationId);
      if(!product) throw new ApiError(404,"PRODUCT_NOT_FOUND","Selected product is unavailable.");
      state.productContext={candidates:[{id:product.id,name:product.name.slice(0,160),sku:product.sku.slice(0,100),unit:product.unit.slice(0,30)}],ambiguous:false};
      state.productUnresolved=false;
    } else if(selection.kind==="customer") {
      const customer=await this.services.erp.getCustomer(selection.id,scope.organizationId);
      if(!customer) throw new ApiError(404,"CUSTOMER_NOT_FOUND","Selected customer is unavailable.");
      if(state.customer?.id!==customer.id && state.draft) touchDraft(state);
      state.customer={id:customer.id,name:customer.name.slice(0,160)};state.customerAmbiguous=false;
    } else {
      if(!this.business) throw new ApiError(503,"BUSINESS_TOOLS_UNAVAILABLE","Vendor selection is unavailable.");
      await this.business.selectVendor(selection.id,scope,state);
    }
    delete state.clarification;delete state.paymentPreparation;
  }
  definitions() {
    const reads = [...this.tools.values()].filter(tool => !this.business?.handles(tool.name) && (tool.name !== "prepare_customer_create" || this.services.runtime)).map((tool) => ({ type: "function" as const, name: tool.name, description: tool.description, strict: false, parameters: z.toJSONSchema(tool.schema) }));
    return [...reads, ...(this.services.runtime?.createUnifiedDraft ? ERP_ACTION_DEFINITIONS : []), ...(this.conversationalDrafts ? DRAFT_TOOL_DEFINITIONS : []), ...(this.business ? BUSINESS_TOOL_DEFINITIONS : [])];
  }
  async confirmPendingAction(pending:NonNullable<BusinessState["pendingAction"]>,scope:AgentScope) {
    if(!this.services.runtime?.confirmAndExecute)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","ERP confirmation service is not configured.");
    await this.assertScope(scope);
    return this.services.runtime.confirmAndExecute(pending.draftId,scope.organizationId,scope.userId,pending.idempotencyKey,scope.branchId);
  }
  async execute(name: string, raw: unknown, scope: AgentScope, state?: BusinessState, _originalMessage?: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const mixed=brandsInText(_originalMessage??"").length>1;
    if(mixed && state)delete state.brandHint;
    const brand=mixed?undefined:explicitBrand(_originalMessage??"")??state?.brandHint;
    if(state && explicitBrand(_originalMessage??""))state.brandHint=explicitBrand(_originalMessage!);
    if(brand && raw && typeof raw==="object" && !Array.isArray(raw) && ["search_products","erp_create_estimate","erp_create_invoice"].includes(name))
      raw={...raw,brand};
    if(isErpActionName(name)) {
      if(!this.services.runtime?.createUnifiedDraft)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","ERP action services are not configured.");
      await this.services.tenant.assertPermission(scope,ERP_ACTION_PERMISSIONS[name]);await this.assertScope(scope);signal?.throwIfAborted();
      const parsed=ERP_ACTION_SCHEMAS[name].safeParse(raw);
      if(!parsed.success)throw new ApiError(422,"ERP_ACTION_CLARIFICATION","Please provide the missing or valid action fields: "+parsed.error.issues.map(issue=>issue.path.join(".")).join(", "));
      if(name==="erp_get_business_report") {
        if(!this.services.runtime.getBusinessReport)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","Reporting is not configured.");
        return this.services.runtime.getBusinessReport(parsed.data,scope);
      }
      if(ERP_READ_ACTIONS.has(name)) {
        if(!this.services.runtime.getDepotReport)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","کاروباری رپورٹ دستیاب نہیں۔");
        const choices:any=parsed.data;
        if(name==="erp_correct_vendor_quote"&&!choices.auditId)choices.auditId=state?.workingAuditId;
        return this.services.runtime.getDepotReport(name as ErpReadName,choices,scope);
      }
      const choices:any=parsed.data;
      if(name==="erp_create_estimate" && !choices.customerId && !choices.customerName){
        if(state?.customer && !state.customerAmbiguous)choices.customerId=state.customer.id;
        else if(state?.estimateCustomerChoice){choices.customerName=state.estimateCustomerChoice.name;choices.customerAddress=state.estimateCustomerChoice.address;}
      }
      if(["erp_amend_estimate","erp_accept_companions"].includes(name) && !choices.draftId)choices.draftId=state?.workingActionId;
      return {review:await this.services.runtime.createUnifiedDraft(name as ErpWriteName,choices,scope,state?.inputSource??"text")};
    }
    if (this.business?.handles(name)) {
      if (!state) throw new ApiError(400, "CONVERSATION_CONTEXT_REQUIRED", "Validated conversation state is required.");
      return this.business.execute(name, raw, scope, state, signal);
    }
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
    const result = await tool.execute(input.data, scope, this.services, signal);
    if (name === "lookup_customers" && this.business && result && typeof result === "object" && "resolution" in result && result.resolution === "no_match") {
      return { ...result, ...await this.business.customerSuggestions(scope, signal) };
    }
    return result;
  }
}
