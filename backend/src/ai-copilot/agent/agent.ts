import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors/api-error.js";
import { type ProductContext, type ProductReference } from "./conversation.js";
import type { AgentScope } from "./erp-tools.js";
import { newBusinessState, readBusinessState, writeBusinessState, touchDraft, businessStateSchema, type BusinessState } from "./business-state.js";
import { draftAnswer, type DraftView } from "./draft-tools.js";
import type { AgentModel, FunctionCall } from "./model.js";
import type { RankedEntity, EntityResolution } from "../../services/entity-search.service.js";
import { businessAnswer } from "./business-answer.js";
import { BUSINESS_TOOL_DEFINITIONS, entityNotFoundSchema, type BusinessFact } from "./business-tools.js";
import { isAffirmation, confirmConversationAction } from "../tools/confirmation.js";

const BUSINESS_TOOLS = new Set(BUSINESS_TOOL_DEFINITIONS.map(tool => tool.name));

const MAX_ITERATIONS = 10;
const MAX_CALLS = 12;
const TIMEOUT_MS = 40_000;
const FALLBACK = "جناب، اس وقت ERP سے درخواست کی تصدیق نہیں ہو سکی۔ آپ کی تفصیل محفوظ ہے؛ براہِ کرم دوبارہ کوشش کریں۔";
const CLARIFY_PRODUCT = "Which product do you mean? Please provide its name or SKU.";
export type AgentLogger = { info: (fields: Record<string, unknown>, message: string) => void; warn: (fields: Record<string, unknown>, message: string) => void };
export interface AgentToolExecutor {
  confirmPendingAction?(pending:NonNullable<BusinessState["pendingAction"]>,scope:AgentScope):Promise<any>;
  definitions(): unknown[];
  assertScope?(scope: AgentScope): Promise<void>;
  applySelection?(selection:{kind:"product"|"customer"|"vendor";id:number},scope:AgentScope,state:BusinessState):Promise<void>;
  execute(name: string, raw: unknown, scope: AgentScope, state?: BusinessState, originalMessage?: string, signal?: AbortSignal): Promise<unknown>;
}
export interface AgentResult {
  answer:string; conversationToken:string; conversationId:string; traceId:string; status:string; toolNames:string[]; requiresConfirmation:boolean;
  execution?:any; draft?:DraftView; review?:unknown; businessFacts?:BusinessFact[];
  paymentPreparation?:BusinessState["paymentPreparation"]; clarification?:BusinessState["clarification"];
  preparation?:{intent:string;requiredFields:string[]};
  reports?:unknown[];
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function productReference(value: unknown): ProductReference | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || typeof row.name !== "string" || typeof row.sku !== "string" || typeof row.unit !== "string") return null;
  return { id: Number(row.id), name: row.name.slice(0, 160), sku: row.sku.slice(0, 100), unit: row.unit.slice(0, 30) };
}

function productResults(tool: string, result: unknown): ProductReference[] | null {
  if (tool === "lookup_product" || tool === "get_product") return result ? [productReference(result)].filter((item): item is ProductReference => item !== null) : [];
  if (tool !== "search_products") return null;
  const resolved = result as EntityResolution<RankedEntity> | null;
  const items = resolved?.resolution === "resolved" ? [resolved.bestCandidate] : resolved?.items;
  return Array.isArray(items) ? items.map(productReference).filter((item): item is ProductReference => item !== null) : [];
}

async function withinDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("agent deadline exceeded");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("agent deadline exceeded"));
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
  });
}

export class UnifiedCopilotAgent {
  constructor(private readonly model: AgentModel, private readonly tools: AgentToolExecutor, private readonly timeoutMs = TIMEOUT_MS) {}
  async run(request: { message: string; conversationToken?: string | undefined; conversationId?: string | undefined;selection?:{kind:"product"|"customer"|"vendor";id:number}|undefined }, scope: AgentScope, logger?: AgentLogger):Promise<AgentResult> {
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and tenant context are required");
    if (!request.message.trim() || request.message.length > 20_000) throw new ApiError(400, "VALIDATION_ERROR", "A valid bounded message is required.");
    await this.tools.assertScope?.(scope);
    const traceId = randomUUID();
    let state: BusinessState;
    try { state = readBusinessState(request.conversationToken, scope, request.conversationId); }
    catch {
      const fresh = newBusinessState(scope);
      return { answer: "The conversation context is invalid or expired. Please identify the customer and products again.",
        conversationToken: writeBusinessState(fresh), conversationId: fresh.conversationId, traceId, status: "clarification", toolNames: [] as string[], requiresConfirmation: false };
    }
    if(state.workingActionId && /^(?:جی[، ]*|ہاں[، ]*)?(?:یہ بھی |سب |سامان )?(?:ڈال دو|شامل کر دو|شامل کر دیں|ہاں ڈال دو)[۔.!]*$/u.test(request.message.trim())){
      const prepared:any=await this.tools.execute("erp_accept_companions",{draftId:state.workingActionId},scope,state,request.message);
      const review=prepared.review;const answer=review.preview.summary;
      state.workingActionId=review.draftId;
      state.pendingAction={draftId:review.draftId,idempotencyKey:review.idempotencyKey,summary:answer.slice(0,1000),expires:Date.now()+10*60_000};
      return {answer,status:"review",review,conversationToken:writeBusinessState(state),conversationId:state.conversationId,traceId,requiresConfirmation:true,toolNames:["erp_accept_companions"]};
    }
    if(state.workingActionId && /نہیں.*(?:گاہک|پاس|ہے)|ساتھ.*سامان.*نہیں/u.test(request.message)){
      return {answer:"جی حاجی صاحب، اضافی سامان شامل نہیں کروں گا۔ اصل ایسٹیمیٹ کا پری ویو تیار ہے؛ محفوظ کرنے کے لیے تصدیق کر دیں۔",
        status:"completed",conversationToken:writeBusinessState(state),conversationId:state.conversationId,traceId,requiresConfirmation:!!state.pendingAction,toolNames:[]};
    }
    if(isAffirmation(request.message)) {
      return confirmConversationAction(state,scope,this.tools.confirmPendingAction?.bind(this.tools),traceId);
    }
    // Any new non-affirmative request replaces the previous proposed action.
    delete state.pendingAction;
    const input: unknown[] = state.lastMessage ? [{ role: "user", content: "Previous untrusted wording (not entity or price authority): " + state.lastMessage }] : [];
    if(request.selection) {
      if(!request.conversationToken || !request.conversationId || !this.tools.applySelection) throw new ApiError(422,"INVALID_ENTITY_SELECTION","Select within the current conversation.");
      await this.tools.applySelection(request.selection,scope,state);
      if(state.pendingRequest) input.push({role:"user",content:"Continue this pending untrusted request using the selected ERP reference: "+state.pendingRequest});
    }
    const priorProducts = state.productContext;
    // A new user turn replaces transient approval controls. A fresh payment
    // preparation tool must validate all choices before another review is offered.
    delete state.paymentPreparation;
    let customerAmbiguous = state.customerAmbiguous === true;
    let productUnresolved = state.productUnresolved === true;
    const previouslyUnresolved = productUnresolved;
    let failedProductSearch = false;
    let resolvedCustomerId: number | undefined = state.customer?.id;
    if (priorProducts) input.push({ role: "assistant", content: `Verified product context:${JSON.stringify(priorProducts)}` });
    input.push({ role: "assistant", content: "Server-validated business context (references and user choices only; current prices must be obtained from tools):" + JSON.stringify({
      conversationId: state.conversationId, customer: state.customer, customerAmbiguous, vendor: state.vendor, vendorAmbiguous: state.vendorAmbiguous,
      comparison: state.comparison, comparisonAnalysis: state.comparisonAnalysis, analysis: state.analysis, brandHint: state.brandHint, rateListId: state.rateListId, draft: state.draft,workingActionId:state.workingActionId,workingAuditId:state.workingAuditId,
    }) });
    input.push({ role: "user", content: request.message });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, TIMEOUT_MS));
    const seen = new Set<string>();
    let calls = 0;
    const toolNames: string[] = [];
    let draftView: DraftView | undefined;
    let review: unknown;
    const businessFacts: BusinessFact[] = [];
    const reports:unknown[]=[];
    let verifiedResults = 0;
    let productContext: ProductContext | undefined = priorProducts;
    let productSearches = 0;
    let productLookups = 0;
    let currentCandidates: ProductReference[] = [];
    let uniqueSearchThisTurn = false;
    let requiredToolRetry = false;
    let unresolvedProduct: EntityResolution<RankedEntity> | undefined;
    let unresolvedCustomer: EntityResolution<RankedEntity> | undefined;
    const clarification = (result: EntityResolution<RankedEntity>, kind: string) => {
      const candidates = result.items.map((r) => {
        const row = r as RankedEntity & { city?: string; sku?: string };
        return `${row.name}${row.city ? `, ${row.city}` : ""}${row.sku ? `, SKU ${row.sku}` : ""} (ID ${row.id})`;
      });
      return `Please clarify which ${kind} you mean${candidates.length ? ": " + candidates.join("; ") : " by name, SKU or location"}.`;
    };
    let answer = FALLBACK;
    let status = "limit";
    const customerRequest = /\b(?:new|naya)\s+customer\b|\bcustomer\s+(?:add|create)\b|نیا\s+کسٹمر|کسٹمر\s+ایڈ/i.test(request.message)
      && this.tools.definitions().some(tool => tool && typeof tool === "object" && "name" in tool && tool.name === "prepare_customer_create");
    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        if (controller.signal.aborted) { status = "timeout"; break; }
        const estimateRequest=/\b(?:estimate|quotation|quote)\b|ایسٹیمیٹ|اسٹیمیٹ|کوٹیشن/iu.test(request.message);
        const availableTools=this.tools.definitions().filter(tool=>!estimateRequest || (tool as {name?:string}).name!=="query_inventory");
        const step = await withinDeadline(this.model.respond(input, availableTools, controller.signal, { toolChoice: requiredToolRetry ? "required" : "auto" }), controller.signal);
        const functions = step.output.filter((item): item is FunctionCall => item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && typeof item.arguments === "string");
        if (functions.length === 0) {
          if (verifiedResults === 0 && customerRequest) {
            answer = "Please provide the new customer's name, phone number and city/address. Review and explicit confirmation are required before creation.";
            status = "clarification"; break;
          }
          if (businessFacts.length) {
            answer = businessAnswer(businessFacts, request.message);
            if (draftView) answer += "\n\n" + draftAnswer(draftView, request.message);
            status = "completed"; break;
          }
          if (state.vendorAmbiguous && toolNames.includes("lookup_vendors")) {
            answer = "Please clarify which vendor you mean by name or location."; status = "clarification"; break;
          }
          if (unresolvedProduct?.resolution === "no_match" || unresolvedCustomer?.resolution === "no_match") {
            answer = unresolvedProduct?.resolution === "no_match" ? "No matching ERP product is available. Please clarify its name or SKU." : "No matching ERP customer is available. Please clarify the name or location.";
            status = "completed"; break;
          }
          if (unresolvedProduct || unresolvedCustomer || customerAmbiguous) {
            answer = unresolvedProduct ? clarification(unresolvedProduct,"product") : unresolvedCustomer ? clarification(unresolvedCustomer,"customer") : "Please clarify which customer you mean by name or location.";
            status = "clarification"; break;
          }
          if (productUnresolved || productContext?.ambiguous) {
            answer = CLARIFY_PRODUCT;
            status = "clarification"; break;
          }
          if (verifiedResults === 0 && priorProducts?.ambiguous) { answer = CLARIFY_PRODUCT; status = "clarification"; break; }
          if (verifiedResults === 0 && priorProducts?.candidates.length === 1 && !requiredToolRetry) { requiredToolRetry = true; continue; }
          if (step.text && verifiedResults > 0) { answer = draftView ? draftAnswer(draftView, request.message) : step.text.slice(0, 4000); status = "completed"; }
          else status = "empty";
          break;
        }
        requiredToolRetry = false;
        if (functions.length !== step.output.filter((item) => item.type === "function_call").length) { status = "malformed"; break; }
        if (calls + functions.length > MAX_CALLS) { status = "call_limit"; break; }
        input.push(...step.output);
        for (const call of functions) {
          if (controller.signal.aborted) { status = "timeout"; break; }
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { status = "malformed"; break; }
          const key = `${call.name}:${JSON.stringify(canonical(args))}`;
          if(estimateRequest && call.name==="query_inventory") {
            input.push({type:"function_call_output",call_id:call.call_id,output:JSON.stringify({notRequired:true,message:"ایسٹیمیٹ کے لیے اسٹاک درکار نہیں۔ فعال ریٹ لسٹ سے erp_create_estimate تیار کریں۔"})});
            continue;
          }
          if (seen.has(key)) { status = "duplicate"; break; }
          if (call.name === "lookup_current_sale_rate" && args && typeof args === "object" &&
              ((uniqueSearchThisTurn && "product_id" in args && args.product_id !== productContext?.candidates[0]?.id) ||
               (resolvedCustomerId !== undefined && "customer_id" in args && args.customer_id !== resolvedCustomerId))) {
            answer = "Please clarify the entity selection; the requested ID does not match the resolved ERP candidate.";
            status = "clarification"; break;
          }
          if (call.name === "lookup_current_sale_rate" &&
              (unresolvedProduct || unresolvedCustomer || productUnresolved || customerAmbiguous || (priorProducts?.ambiguous && !uniqueSearchThisTurn))) {
            answer = unresolvedProduct ? clarification(unresolvedProduct,"product") : unresolvedCustomer ? clarification(unresolvedCustomer,"customer") : customerAmbiguous ? "Please clarify which customer you mean by name or location." : CLARIFY_PRODUCT;
            status = "clarification"; break;
          }
          seen.add(key);
          calls++;
          try {
            state.productContext = productContext;
            state.productUnresolved = productUnresolved;
            state.customerAmbiguous = customerAmbiguous;
            const priorCustomerId = state.customer?.id;
            const result = await withinDeadline(this.tools.execute(call.name, args, scope, state, request.message, controller.signal), controller.signal);
            verifiedResults++;
            toolNames.push(call.name);
            if(result && typeof result==="object" && "report" in result){
              reports.push(result.report);const report=result.report as any;
              if(typeof report.auditId==="string")state.workingAuditId=report.auditId;
            }
            if (BUSINESS_TOOLS.has(call.name)) {
              productContext = state.productContext;
              productUnresolved = state.productUnresolved === true;
              customerAmbiguous = state.customerAmbiguous === true;
              resolvedCustomerId = state.customer?.id;
              if (priorCustomerId !== resolvedCustomerId && state.draft) { touchDraft(state); draftView = undefined; }
              if (result && typeof result === "object" && "kind" in result) {
                businessFacts.push(result as BusinessFact);
                if ("product" in result) { unresolvedProduct = undefined; uniqueSearchThisTurn = true; }
                if ("customer" in result) unresolvedCustomer = undefined;
              }
            } else if (call.name === "lookup_current_sale_rate" && this.tools.definitions().some(tool => tool && typeof tool === "object" && "name" in tool && tool.name === "query_inventory")) {
              businessFacts.push({ kind: "sale_rate", rate: result });
            }
            if (result && typeof result === "object" && "review" in result && result.review) {
              review = result.review;
              const prepared=result.review as {draftId?:string;idempotencyKey?:string;preview?:{summary?:string}};
              answer=prepared.preview?.summary??"Review the prepared ERP action and confirm it explicitly before execution.";
              if(prepared.draftId&&prepared.idempotencyKey)state.pendingAction={draftId:prepared.draftId,idempotencyKey:prepared.idempotencyKey,summary:answer.slice(0,1000),expires:Date.now()+10*60_000};
              if((result.review as any).tool==="erp_create_estimate")state.workingActionId=prepared.draftId;
              status = "completed"; break;
            }
            if(call.name==="erp_get_business_report"&&result&&typeof result==="object"&&"answer" in result&&typeof result.answer==="string") {
              answer=result.answer;status="completed";review=undefined;break;
            }
            if (result && typeof result === "object" && "requiresConfirmation" in result && "lines" in result && "totals" in result) draftView = result as DraftView;
            if (call.name === "search_products" || call.name === "lookup_customers") {
              const resolution = result as EntityResolution<RankedEntity>;
              if (resolution.resolution === "no_match" && this.tools.definitions().some(tool => tool && typeof tool === "object" && "name" in tool && tool.name === "query_inventory")) {
                const missing = entityNotFoundSchema.safeParse({ entity: call.name === "search_products" ? "product" : "customer",
                  query: (args as { query?: string }).query,
                  ...(call.name === "lookup_customers" && result && typeof result === "object" ? {
                    ...("currentCustomers" in result ? { currentCustomers: result.currentCustomers } : {}),
                    ...("hasMore" in result ? { hasMore: result.hasMore } : {}),
                  } : {}),
                });
                if (missing.success) businessFacts.push({ kind: "entity_not_found", ...missing.data });
              }
              const unresolved = resolution.requiresClarification ? resolution : undefined;
              if(unresolved && resolution.items.length) state.clarification={kind:call.name==="search_products"?"product":"customer",candidates:resolution.items.slice(0,5).map(row=>{
                const candidate=row as RankedEntity & {sku?:string;unit?:string;city?:string};
                return {id:row.id,name:row.name.slice(0,160),...(candidate.sku?{sku:candidate.sku.slice(0,100)}:{}),...(candidate.unit?{unit:candidate.unit.slice(0,30)}:{}),...(candidate.city?{city:candidate.city.slice(0,120)}:{})};
              })};
              else if(state.clarification?.kind===(call.name==="search_products"?"product":"customer")) delete state.clarification;
              if (call.name === "search_products") { unresolvedProduct = unresolved; productUnresolved = resolution.resolution !== "resolved"; }
              else {
                unresolvedCustomer = unresolved; customerAmbiguous = resolution.resolution !== "resolved"; resolvedCustomerId = resolution.bestCandidate?.id;
                if (state.customer?.id !== resolvedCustomerId && state.draft) { touchDraft(state); draftView = undefined; }
                if (!customerAmbiguous && resolution.bestCandidate) state.customer = { id: resolution.bestCandidate.id, name: resolution.bestCandidate.name.slice(0, 160) };
                else delete state.customer;
              }
            }
            const candidates = productResults(call.name, result);
            if (candidates !== null) {
              if (call.name === "search_products") { currentCandidates = []; productSearches++; }
              else if (productSearches === 0 && productLookups === 0 && !priorProducts?.ambiguous) currentCandidates = [];
              if (call.name === "lookup_product") productLookups++;
              for (const item of candidates) if (!currentCandidates.some((candidate) => candidate.id === item.id)) currentCandidates.push(item);
              if (!(priorProducts?.ambiguous && productSearches === 0)) {
                productContext = currentCandidates.length ? { candidates: currentCandidates.slice(0, 5), ambiguous: !!unresolvedProduct || currentCandidates.length > 1 } : undefined;
              }
              uniqueSearchThisTurn = !unresolvedProduct && productSearches > 0 && currentCandidates.length === 1;
              if (call.name !== "search_products" && failedProductSearch && !previouslyUnresolved && !priorProducts?.ambiguous && currentCandidates.length === 1 && !unresolvedProduct) productUnresolved = false;
            }
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result ?? null) });
            logger?.info({ traceId, iteration, tool: call.name, outcome: "ok" }, "Copilot tool executed");
          } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
            if (["search_products", "lookup_customers", "lookup_vendors"].includes(call.name)) {
              delete state.clarification;
              if (call.name === "search_products") { productContext = undefined; productUnresolved = true; failedProductSearch = true; }
              if (call.name === "lookup_customers") { delete state.customer; customerAmbiguous = true; resolvedCustomerId = undefined; }
            }
            // A failed new selection must not leave a previous entity available
            // for an unrelated payment or pronoun follow-up.
            if (BUSINESS_TOOLS.has(call.name) && args && typeof args === "object") {
              if (call.name === "lookup_vendors") { delete state.vendor; state.vendorAmbiguous = true; }
              if (call.name === "query_customer_ledger" && "query" in args) {
                if (state.draft) { touchDraft(state); draftView = undefined; }
                delete state.customer; customerAmbiguous = true; resolvedCustomerId = undefined;
              }
              if (["query_inventory", "calculate_margin", "compare_products"].includes(call.name) && ("query" in args || "queries" in args)) {
                productContext = undefined; productUnresolved = true; delete state.analysis;
                if (call.name === "compare_products") { delete state.comparison; delete state.comparisonAnalysis; }
              }
            }
            if (error instanceof ApiError && ["DRAFT_CONTEXT_REQUIRED", "BUSINESS_CONTEXT_REQUIRED","ERP_ACTION_CLARIFICATION"].includes(error.code)) {
              const candidates = businessStateSchema.shape.clarification.safeParse(error.details);
              if (candidates.success && candidates.data) state.clarification = candidates.data;
              if (call.name === "compare_products") { delete state.comparison; delete state.comparisonAnalysis; }
              answer = error.message; status = "clarification"; break;
            }
            if (error instanceof ApiError && error.code === "COPILOT_ENTITY_NOT_FOUND") {
              const missing = entityNotFoundSchema.safeParse(error.details);
              if (missing.success) {
                const fact = { kind: "entity_not_found", ...missing.data };
                businessFacts.push(fact);
                verifiedResults++;
                toolNames.push(call.name);
                input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(fact) });
                logger?.info({ traceId, iteration, tool: call.name, outcome: "not_found" }, "Copilot entity lookup completed");
                continue;
              }
            }
            if (BUSINESS_TOOLS.has(call.name)) businessFacts.push({ kind: "unavailable", message: `${call.name}: authoritative result unavailable or arguments invalid. Please clarify or retry.` });
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: "Tool result unavailable or arguments invalid" }) });
            logger?.warn({ traceId, iteration, tool: call.name, outcome: "error", errorCode: error instanceof ApiError ? error.code : "UNEXPECTED_TOOL_ERROR" }, "Copilot tool failed");
          }
        }
        if (review || status === "malformed" || status === "duplicate" || status === "clarification" || status === "timeout") break;
      }
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
      logger?.warn({ traceId, errorCode: error instanceof ApiError ? error.code : "UNEXPECTED_PROVIDER_ERROR" }, "Copilot reasoning failed");
      if (error instanceof ApiError && error.status === 429) {
        status = "rate_limited";
        answer = "The configured AI provider rate limit was reached. Your conversation choices are preserved. Please wait before retrying.";
        // Preserve choices, invalidate approval, and refresh the display only
        // through the same scoped read tool. A quota failure never prepares work.
        if (state.draft) {
          delete state.draft.preparedRevision;
          draftView = undefined;
          try {
            draftView = await withinDeadline(this.tools.execute("inspect_draft", {}, scope, state, request.message, controller.signal), controller.signal) as DraftView;
            toolNames.push("inspect_draft");
          } catch (refreshError) {
            if (refreshError instanceof ApiError && [401, 403].includes(refreshError.status)) throw refreshError;
          }
        }
      } else {
        status = controller.signal.aborted ? "timeout" : "error";
        if (error instanceof ApiError && ["AI_NOT_CONFIGURED", "COPILOT_NOT_CONFIGURED"].includes(error.code)) {
          answer = error.code === "AI_NOT_CONFIGURED"
            ? "Enter your Gemini API key in Copilot API key settings for conversational workflows. Basic stock inquiries remain available without a key."
            : "ERP data access is not configured. Please contact your administrator. Manual ERP pages remain available.";
        } else if (error instanceof ApiError && ["AI_PROVIDER_BAD_REQUEST", "AI_MODEL_UNAVAILABLE", "AI_PROVIDER_PAYMENT_REQUIRED"].includes(error.code)) {
          // These messages are authored by this service and contain no provider
          // response body, so they can distinguish actionable setup failures.
          answer = `${error.message} No ERP action was performed.`;
        } else if (error instanceof ApiError && error.code.startsWith("AI_PROVIDER_")) {
          answer = "The configured AI provider could not complete this request. Please try again or use the Customers and Stock pages. No ERP action was performed.";
        }
      }
    } finally { clearTimeout(timer); }
    if (businessFacts.length && status !== "completed") {
      answer = businessAnswer(businessFacts, request.message) + "\n\n" + (status === "clarification" ? answer : "These are the verified results available so far. Please retry any remaining part of the request.");
    }
    logger?.info({ traceId, status, calls }, "Copilot agent finished");
    state.productContext = productContext;
    state.customerAmbiguous = customerAmbiguous;
    state.productUnresolved = productUnresolved;
    state.lastMessage = request.message.slice(0, 500);
    state.expires = Date.now() + 30 * 60_000;
    state.revision++;
    if (draftView && status === "completed" && businessFacts.length === 0) {
      answer = draftAnswer(draftView, request.message);
    }
    if (status !== "completed") delete state.paymentPreparation;
    if(!state.productUnresolved && !state.customerAmbiguous && !state.vendorAmbiguous) delete state.clarification;
    if(status==="clarification" && !request.selection && request.message.length<=4000) state.pendingRequest=request.message;
    if(status==="completed" && !state.clarification) delete state.pendingRequest;
    return { answer, conversationToken: writeBusinessState(state), conversationId: state.conversationId, traceId, status, toolNames,
      ...(status === "clarification" && customerRequest && !review ? { preparation: { intent: "customer_create", requiredFields: ["name", "phone", "city"] } } : {}),
      ...(draftView ? { draft: draftView } : {}), ...(review ? { review } : {}),
      ...(businessFacts.length ? { businessFacts } : {}), ...(state.paymentPreparation ? { paymentPreparation: state.paymentPreparation } : {}),
      ...(state.clarification ? {clarification:state.clarification}:{}),
      ...(reports.length?{reports}:{}),
      requiresConfirmation: Boolean(review || draftView?.prepared || state.paymentPreparation) };
  }
}

// Compatibility name for Phase 1 callers; the implementation is the unified loop.
export { UnifiedCopilotAgent as ReadOnlyCopilotAgent };
