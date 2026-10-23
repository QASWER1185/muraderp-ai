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
import { ANALYTICS_DEFINITIONS, ANALYTICS_SCHEMAS, ANALYTICS_PERMISSIONS, isAnalyticsTool, analyticsAnswer, type CopilotAnalytics } from "../analytics.js";
import { auditDuraCatalog } from "../catalogIntegrity.js";
import { isEnglishRequest } from "./language.js";
import { normalizeProductSearchQuery } from "../../services/entity-search.service.js";
import {brandRates} from "./brand-rates.js";
import {estimateCaptionChoices} from "./multimodal-input.js";
import {canonicalSlipWords} from "../conversationalMunshi.js";
import {categoryDiscountChoices} from "../hybridQuotationEngine.js";

export type AgentScope = { userId: string; organizationId: string; branchId: string };
export type ToolServices = {
  analytics?:Pick<CopilotAnalytics,"read">;
  memory?: CustomerMemory;
  tenant: Pick<TenantAccessService, "assertPermission" | "assertBranchAccess">;
  erp: Pick<ErpService, "getProduct" | "getCustomer">;
  catalog: Pick<CopilotCatalogRepository, "getCatalog">;
  search: EntitySearchService;
  pricing: Pick<PricingService, "resolvePrice">;
  rateLists: Pick<RateListRepository, "listActiveSaleRateLists"> & Pick<RateListLifecycleRepository, "getVersion">;
  runtime?: Pick<CopilotRuntime, "createMasterDataDraft"> & Partial<Pick<CopilotRuntime,"createUnifiedDraft"|"reviseUnifiedDraft"|"inspectUnifiedDraft"|"getBusinessReport"|"getDepotReport"|"confirmAndExecute">>;
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
const revisionSchema=z.strictObject({draftId:z.string().uuid().optional(),changes:z.record(z.string(),z.unknown())});
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
  defineTool({name:"erp_compare_brand_rates",description:"Compare active catalog list prices, merchant standard trade discounts and net customer rates for Dura Max, Popular and Turk Plast. Use when a rate question has no specific brand or requests several companies. Preserve full material, diameter and angle; unavailable or ambiguous brands have no invented price. An explicit discount_percent overrides comparison defaults. Read only.",schema:lookup.extend({brands:z.array(query).min(1).max(5).default(["Dura Max","Popular","Turk Plast"]),quantity:z.number().positive().default(1),discount_percent:z.number().min(0).max(100).optional()}),permission:"sales.read",authentication:"required",scope:"organization_and_branch",classification:"read",execute:async(input,scope,services,signal)=>brandRates(input,scope,services,signal)}),
  defineTool({name:"erp_get_product_sale_rate",description:"Answer a standalone product rate question in ONE read. Supply the full product name, brand, material, size and angle. The server resolves the item and its active global sale rate automatically; never guess product or rate-list IDs. For customer-specific negotiated prices use the customer-aware lookup_current_sale_rate workflow.",schema:lookup.extend({brand:query.optional(),quantity:z.number().finite().positive().default(1)}),permission:"sales.read",authentication:"required",scope:"organization_and_branch",classification:"read",execute:async({query,limit,brand,quantity},scope,{search,pricing,rateLists,tenant},signal)=>{
    await tenant.assertPermission(scope,"products.read");
    const match=await search.searchProducts(query,limit,scope,brand);
    signal?.throwIfAborted();
    if(match.resolution!=="resolved"||!match.bestCandidate)return match;
    const product=match.bestCandidate;
    const rate=await pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity,as_of:new Date().toISOString()});
    signal?.throwIfAborted();
    if(rate){const version=await rateLists.getVersion(rate.rate_list_version_id);if(version.rate_list_id!==rate.rate_list_id||rate.product_id!==product.id)throw new ApiError(502,"RATE_SOURCE_INVALID","The sale-rate source could not be verified.");}
    return {...match,verifiedSaleRate:true,rate,product,analytics:true,answer:product.name+" — "+(rate?`${rate.currency_code} ${rate.unit_price}/${rate.unit}`:"فعال فروخت کا ریٹ دستیاب نہیں۔")};
  }}),
  defineTool({name:"erp_audit_catalog_rates",description:"Audit the merchant's Dura Max Medium pipe, Single P-Trap, Plastic Head/Cap Gate Valve and 500g solvent baselines against active one-to-one catalog rates. Returns exact correction candidates, never changes rates. If asked to correct, prepare the returned candidates with erp_update_commodity_rates and require the normal one-click approval.",schema:z.strictObject({}),permission:"products.read",authentication:"required",scope:"organization_and_branch",classification:"read",execute:async(_input,scope,services)=>auditDuraCatalog(services,scope)}),
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
    return [...reads, ...(this.services.analytics?ANALYTICS_DEFINITIONS:[]), ...(this.services.runtime?.createUnifiedDraft ? ERP_ACTION_DEFINITIONS : []),
      ...(this.services.runtime?.reviseUnifiedDraft?[{type:"function" as const,name:"revise_pending_action",strict:false,parameters:z.toJSONSchema(revisionSchema),description:"Correct the current unconfirmed invoice, estimate conversion, receipt, return or other ERP action. Omit draftId for working context. Supply ONLY changed original tool input fields in changes (e.g. paidAmount for cash/credit, invoiceId for return source). Every omitted item and field is retained. Creates a fresh validated preview; never edits posted records or approves a posting. For estimate item/category edits use erp_amend_estimate."}]:[]),
      ...(this.services.runtime?.inspectUnifiedDraft?[{type:"function" as const,name:"inspect_pending_action",strict:false,parameters:z.toJSONSchema(z.strictObject({})),description:"Read all original items and stable lineNumber values in the current unconfirmed action. Call before correcting specific estimate rows; never guess row numbers from truncated dialogue. Returns scoped source inputs, not current prices. Then use erp_amend_estimate updateLines. Unknown observed additions may be added by name/size/qty/unit without productId and stay pending."}]:[]),
      ...(this.conversationalDrafts ? DRAFT_TOOL_DEFINITIONS : []), ...(this.business ? BUSINESS_TOOL_DEFINITIONS : [])];
  }
  async confirmPendingAction(pending:NonNullable<BusinessState["pendingAction"]>,scope:AgentScope) {
    if(!this.services.runtime?.confirmAndExecute)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","ERP confirmation service is not configured.");
    await this.assertScope(scope);
    return this.services.runtime.confirmAndExecute(pending.draftId,scope.organizationId,scope.userId,pending.idempotencyKey,scope.branchId);
  }
  async execute(name: string, raw: unknown, scope: AgentScope, state?: BusinessState, _originalMessage?: string, signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    if(name==="inspect_pending_action"){
      await this.assertScope(scope);
      if(!state?.workingActionId||!this.services.runtime?.inspectUnifiedDraft)throw new ApiError(422,"ERP_ACTION_CLARIFICATION","جناب، پہلے اسی گفتگو کا غیر منظور شدہ مسودہ منتخب کریں۔");
      return this.services.runtime.inspectUnifiedDraft(state.workingActionId,scope);
    }
    if(name==="revise_pending_action"){
      if(!this.services.runtime?.reviseUnifiedDraft)throw new ApiError(503,"COPILOT_NOT_CONFIGURED","Revision service is unavailable.");
      await this.assertScope(scope);
      const input=revisionSchema.parse(raw),draftId=input.draftId??state?.workingActionId;
      if(!draftId)throw new ApiError(422,"ERP_ACTION_CLARIFICATION","جناب، پہلے مطلوبہ کارروائی کا پری ویو تیار کریں تاکہ اسی کی تفصیل درست کر سکوں۔");
      return {review:await this.services.runtime.reviseUnifiedDraft(draftId,input.changes,scope,state?.inputSource??"text")};
    }
    if(isAnalyticsTool(name)){
      if(!this.services.analytics)throw new ApiError(503,"ANALYTICS_UNAVAILABLE","Analytics is not configured.");
      const input=ANALYTICS_SCHEMAS[name].parse(raw);
      await this.assertScope(scope);
      for(const permission of ANALYTICS_PERMISSIONS[name])await this.services.tenant.assertPermission(scope,permission);
      signal?.throwIfAborted();
      const report=await this.services.analytics.read(name,input,scope);
      report.language=isEnglishRequest(_originalMessage??"")?"en":"ur";
      return {analytics:true,answer:analyticsAnswer(report,_originalMessage??""),report};
    }
    const mixed=brandsInText(_originalMessage??"").length>1;
    if(["search_products","erp_get_product_sale_rate","erp_compare_brand_rates"].includes(name)&&_originalMessage&&raw&&typeof raw==="object"&&!Array.isArray(raw)){
      const percent=estimateCaptionChoices(_originalMessage).percent;
      const brand=explicitBrand(_originalMessage);
      const isRate=name==="erp_compare_brand_rates"||/ریٹ|قیمت|نرخ|\b(?:rate|price)\b/iu.test(_originalMessage);
      if(isRate&&name!=="search_products"&&(name==="erp_compare_brand_rates"||!brand||percent!==undefined)){
        const given=raw as Record<string,unknown>;
        const withoutDiscount=_originalMessage.replace(/\s*\d+(?:\.\d+)?\s*(?:%|فیصد|پرسنٹ|percent\b)\s*(?:پر)?/giu,"");
        const originalQuery=canonicalSlipWords(normalizeProductSearchQuery(withoutDiscount));
        const hasProduct=/\b(?:pipe|elbow|tee|socket|trap|valve|union|adapter|reducer|solvent)\b/i.test(originalQuery);
        const query=(hasProduct?originalQuery:String(given.query??""))
          .replace(/\b(?:Dura\s*Max|Popular|Turk\s*Plast|HE\s*China)\b/giu,"").replace(/\s+/g," ").trim();
        if(query.length<=120)return this.execute("erp_compare_brand_rates",{query,limit:given.limit??10,quantity:given.quantity??1,brands:brand?[brand]:mixed?brandsInText(_originalMessage):given.brands??["Dura Max","Popular","Turk Plast"],...(percent!==undefined?{discount_percent:percent}:{})},scope,state,undefined,signal);
      }
    }
    if(["search_products","erp_get_product_sale_rate"].includes(name)&&_originalMessage&&raw&&typeof raw==="object"&&!Array.isArray(raw)){
      // Preserve the user's exact specs when removing recognized rate-question
      // wording. A model refinement must not silently drop an angle or size.
      const original=_originalMessage.trim().replace(/[?؟.]+$/u,"");
      const normalized=normalizeProductSearchQuery(_originalMessage);
      if(normalized!==original&&normalized.length<=120){
        raw={...raw,query:normalized};
        // The native model already selected product search. Complete this
        // explicit rate read through the same scoped resolver, rather than
        // asking the model to invent a second ID-based call.
        if(name==="search_products")return this.execute("erp_get_product_sale_rate",raw,scope,state,_originalMessage,signal);
      }
    }
    if(mixed && state)delete state.brandHint;
    const brand=mixed?undefined:explicitBrand(_originalMessage??"")??state?.brandHint;
    if(state && explicitBrand(_originalMessage??""))state.brandHint=explicitBrand(_originalMessage!);
    if(brand && raw && typeof raw==="object" && !Array.isArray(raw) && ["search_products","erp_get_product_sale_rate","erp_create_estimate","erp_create_invoice"].includes(name))
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
      if(["erp_create_estimate","erp_amend_estimate"].includes(name)&&_originalMessage){
        const rules=categoryDiscountChoices(_originalMessage);
        if(rules.length)choices.pricingRules=[...(choices.pricingRules??[]).filter((rule:any)=>!rules.some(choice=>choice.match===rule.match)),...rules];
      }
      if(name==="erp_create_estimate" && _originalMessage){
        const observed=estimateCaptionChoices(_originalMessage);
        if(!choices.customerId && (observed.customerName??state?.estimateCustomerChoice?.name))choices.customerName=observed.customerName??state!.estimateCustomerChoice!.name;
        const normalize=(value:string)=>value.normalize("NFKC").replace(/\s+/gu," ").trim().toLowerCase();
        if(choices.customerAddress && !normalize(_originalMessage).includes(normalize(choices.customerAddress)) && choices.customerAddress!==state?.estimateCustomerChoice?.address)
          delete choices.customerAddress;
      }
      if(name==="erp_create_estimate" && !choices.customerId && !choices.customerName){
        if(state?.customer && !state.customerAmbiguous)choices.customerId=state.customer.id;
        else if(state?.estimateCustomerChoice){choices.customerName=state.estimateCustomerChoice.name;choices.customerAddress=state.estimateCustomerChoice.address;}
      }
      if(["erp_amend_estimate","erp_accept_companions"].includes(name) && !choices.draftId)choices.draftId=state?.workingActionId;
      const review=await this.services.runtime.createUnifiedDraft(name as ErpWriteName,choices,scope,state?.inputSource??"text");
      if(state && name==="erp_create_estimate" && choices.customerName)
        state.estimateCustomerChoice={name:choices.customerName,...(choices.customerAddress?{address:choices.customerAddress}:{})};
      return {review};
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
