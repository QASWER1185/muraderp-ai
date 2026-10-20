import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors/api-error.js";
import { writeBusinessState, type BusinessState } from "../agent/business-state.js";
import type { AgentScope } from "../agent/erp-tools.js";
import type { AgentResult } from "../agent/agent.js";

/** Whole-turn approval grammar. Negations, questions, quoted text and changed
 * prices/discounts are not permission to execute the saved preview. */
export function isAffirmation(message:string):boolean {
  const text=message.normalize("NFKC").trim().toLowerCase().replace(/[.!،۔]+$/gu,"").replace(/\s+/gu," ").trim();
  if (/^(?:جی|ہاں|جی ہاں|کر دیں|جی کر دیں|yes|ok|okay|confirm|save|import|ji|jee|han|haan|kar dein|ker dein)$/u.test(text)) return true;
  if (/^(?:please )?(?:save|import|confirm|enter|update)(?: (?:the|these|those|all|extracted))* (?:rates|prices|rate list|price list)(?: (?:in|into|to) (?:the )?(?:erp|system))?(?: please)?$/u.test(text)) return true;
  if (/^(?:(?:ji|jee|han|haan|yes|ok|okay) )?(?:(?:(?:jo )?(?:rates?|prices?|rate list|price list)(?: (?:nikale|nikalay) (?:hain|hen))?|jo) )?(?:(?:un ko|unko|in ko|inko) )?(?:(?:erp(?: (?:ke|k) (?:andar|ander))?|rate list|system)(?: (?:mein|main|me|mai))? )?(?:(?:mein|main|me|mai) )?(?:darj|save|import|enter|update|confirm)(?: (?:kar|ker))? (?:dein|den|do|lein|len)$/u.test(text)) return true;
  return /^(?:(?:جی|ہاں|جی ہاں) )?(?:(?:(?:جو )?(?:ریٹ(?: لسٹ)?|قیمتیں|نرخ)(?: (?:نکالے|نکالی) (?:ہیں|ہے))?|جو) )?(?:(?:ان کو|انکو|انھیں|انہیں|ان|ان سب کو) )?(?:(?:ای آر پی|ای ار پی|erp|ریٹ لسٹ|سسٹم)(?: (?:کے اندر|میں))? )?(?:(?:میں|کو) )?(?:درج|محفوظ|سیو|امپورٹ|اپ ڈیٹ)(?: کر)? (?:دیں|دو|دین)$/u.test(text);
}

export async function confirmConversationAction(state:BusinessState,scope:AgentScope,
  execute:((pending:NonNullable<BusinessState["pendingAction"]>,scope:AgentScope)=>Promise<any>)|undefined,
  traceId:string=randomUUID()):Promise<AgentResult> {
  const pending=state.pendingAction;
  if(!pending || pending.expires<=Date.now() || !execute) {
    delete state.pendingAction;
    return {answer:"منظوری کے لیے کوئی موجودہ preview موجود نہیں۔ پہلے مطلوبہ کام کا preview تیار کریں۔",status:"clarification",
      conversationToken:writeBusinessState(state),conversationId:state.conversationId,traceId,requiresConfirmation:false,toolNames:[]};
  }
  // The runtime rechecks actor, tenant, branch, permissions and idempotency,
  // then verifies the committed ERP record before returning EXECUTED.
  const completed=await execute(pending,scope);
  if(completed.status!=="EXECUTED")throw new ApiError(502,"ERP_ACTION_UNVERIFIED","عمل کی ERP میں تصدیق نہیں ہو سکی۔");
  const catalog=completed.action_plan?.catalogImport??completed.action_plan?.unifiedAction?.data?.catalog;
  const catalogSummary=catalog ? {name:catalog.name,itemCount:catalog.items.length,brand:[...new Set(catalog.items.map((item:any)=>item.brand))].join(" / ")} : pending.catalog;
  let answer=completed.result?.memoryMessage ?? "ERP میں کامیابی سے درج اور تصدیق ہو گئی ہے۔ ریکارڈ ID: "+String(executionIdentity(completed.result))+"۔";
  if(catalogSummary) {
    const name=catalogSummary.brand && !catalogSummary.name.toLowerCase().includes(catalogSummary.brand.toLowerCase()) ? catalogSummary.brand+" "+catalogSummary.name : catalogSummary.name;
    answer=`✓ مبارک ہو! ${name} کے تمام ${catalogSummary.itemCount} آئٹمز ERP ریٹ لسٹ میں کامیابی سے درج کر دیے گئے ہیں۔`;
  }
  delete state.pendingAction;state.revision++;
  return {answer,status:"completed",execution:completed,conversationToken:writeBusinessState(state),conversationId:state.conversationId,traceId,
    toolNames:["confirm_erp_action",...(catalogSummary?["erp_import_rate_list"]:[])],requiresConfirmation:false};
}
export function executionIdentity(result:any):unknown {
  return result?.invoice_id??result?.invoice?.id??result?.payment?.id??result?.rate_list?.id??result?.id??result?.version?.id;
}
