import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { AuthorizationService } from "../auth/authorization.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { SupabaseAuthorizationGateway, createAuthorizationClient } from "../auth/supabase-authorization.gateway.js";
import { env } from "../config/env.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { DefaultEstimateService } from "../services/estimate.service.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { DefaultEstimatePricingService } from "../services/estimate-pricing.service.js";
import { DefaultPricingService } from "../services/pricing.service.js";
import { SupabasePricingRepository } from "../repositories/pricing.repository.js";
import { SupabaseSalesTransactionAdapter } from "../services/supabase-sales-transaction.adapter.js";
import { SupabaseSalesReturnService } from "../services/sales-return.service.js";
import { buildDirectInvoice, type InvoiceDocument } from "../types/invoice.types.js";
import type { SalesTransactionLine } from "../types/sales-transaction.types.js";
import type { AiDraft } from "../ai-input/contracts.js";
import type { CopilotActionPlan } from "./copilot.types.js";
import { createCopilotPlanFromDraft, assertCopilotDraftExecution } from "./copilot.service.js";

const PERMISSION_BY_INTENT: Record<CopilotActionPlan["target"], PermissionCode> = { estimate: "sales.create", invoice: "sales.create", customer_return: "returns.create", supplier_bill: "purchases.create", inventory_adjustment: "inventory.adjust" };
function client() { return getSupabaseAdminClient() as any; }
function stableValue(value: unknown): unknown { if (Array.isArray(value)) return value.map(stableValue); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)])); return value; }
export function copilotFingerprint(plan: CopilotActionPlan): string { return createHash("sha256").update(JSON.stringify(stableValue(plan)), "utf8").digest("hex"); }
function positiveId(value: string | undefined, field: string): number { if (!value) throw new Error(`${field} is required`); const parsed = Number(value); if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`); return parsed; }
function isoDate(value?: string): string { const date = value ?? new Date().toISOString().slice(0, 10); if (Number.isNaN(Date.parse(date))) throw new Error("documentDate must be a valid date"); return date.slice(0, 10); }
type RuntimeLine = { productId: number; quantity: number; unit?: string; rate?: number; rateListId?: number; sourceItemId?: number };
function requireLineProducts(plan: CopilotActionPlan): RuntimeLine[] { return plan.lines.map((line) => { if (line.productId === undefined) throw new Error(`product resolution is required for ${line.productName}`); const result: RuntimeLine = { productId: line.productId, quantity: line.quantity }; if (line.unit !== undefined) result.unit = line.unit; if (line.explicitUnitRate !== undefined) result.rate = line.explicitUnitRate; const rateListId = line.pricingSelection?.mode === "RATE_LIST" ? line.pricingSelection.rate_list_id : undefined; if (rateListId != null) result.rateListId = rateListId; if (line.sourceItemId !== undefined) result.sourceItemId = line.sourceItemId; return result; }); }
function sourceType(source: CopilotActionPlan["source"]): "VOICE" | "OCR" | "AI_ASSISTED" { if (source === "voice") return "VOICE"; if (source === "image" || source === "camera") return "OCR"; return "AI_ASSISTED"; }

export class CopilotRuntime {
  private readonly authorization: AuthorizationService;
  private readonly erp: ErpService;
  private readonly pricing = new DefaultPricingService(new SupabasePricingRepository());
  private readonly estimate = new DefaultEstimateService(new SupabaseEstimateRepository(), new DefaultEstimatePricingService(this.pricing));
  private readonly salesTransaction = new SupabaseSalesTransactionAdapter(getSupabaseAdminClient, "ai-copilot");
  private readonly returns = new SupabaseSalesReturnService();
  constructor(erp: ErpService = new SupabaseErpService()) { this.erp = erp; const authClient = createAuthorizationClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY); this.authorization = new AuthorizationService(new SupabaseAuthorizationGateway(authClient)); }
  async createDraft(draft: AiDraft, context: { userId: string; warehouseId?: number; rateListId?: number; documentNumber?: string; documentDate?: string; currencyCode?: string; reason?: string }, idempotencyKey: string) {
    const plan = createCopilotPlanFromDraft(draft, context).plan;
    await this.authorization.assertPermission(plan.userId, plan.organizationId, PERMISSION_BY_INTENT[plan.target]);
    const fingerprint = copilotFingerprint(plan); const db = client();
    const { data: existing, error: existingError } = await db.from("ai_copilot_actions").select("*").eq("organization_id", plan.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle();
    if (existingError) throw existingError;
    if (existing) { if (existing.request_fingerprint !== fingerprint) throw new Error("Idempotency-Key was reused for a different Copilot action"); return existing; }
    const { data, error } = await db.from("ai_copilot_actions").insert({ organization_id: plan.organizationId, user_id: plan.userId, intent: plan.target, status: "DRAFT", idempotency_key: idempotencyKey, request_fingerprint: fingerprint, action_plan: plan }).select("*").single();
    if (error) throw error; return data;
  }
  async confirmAndExecute(actionId: string, organizationId: string, userId: string, idempotencyKey: string) {
    const db = client(); const { data: action, error } = await db.from("ai_copilot_actions").select("*").eq("id", actionId).maybeSingle();
    if (error) throw error; if (!action) throw new Error("Copilot draft was not found"); if (action.organization_id !== organizationId) throw new Error("copilot action organization mismatch"); if (action.user_id !== userId) throw new Error("copilot action user mismatch"); if (action.idempotency_key !== idempotencyKey) throw new Error("copilot confirmation idempotency mismatch");
    const plan = action.action_plan as CopilotActionPlan; assertCopilotDraftExecution(plan, organizationId, userId, plan.target); await this.authorization.assertPermission(userId, organizationId, PERMISSION_BY_INTENT[plan.target]);
    if (action.status === "EXECUTED") return action; if (action.status === "CONFIRMED") throw new Error("Copilot action is already being executed"); if (action.status !== "DRAFT") throw new Error(`Copilot action cannot be confirmed from ${action.status}`);
    const { data: claimed, error: claimError } = await db.from("ai_copilot_actions").update({ status: "CONFIRMED", confirmed_at: new Date().toISOString() }).eq("id", actionId).eq("status", "DRAFT").select("*").maybeSingle();
    if (claimError) throw claimError; if (!claimed) throw new Error("Copilot action was already claimed by another request");
    try { const result = await this.execute(plan, idempotencyKey); const { data: completed, error: completeError } = await db.from("ai_copilot_actions").update({ status: "EXECUTED", result, executed_at: new Date().toISOString() }).eq("id", actionId).eq("status", "CONFIRMED").select("*").single(); if (completeError) throw completeError; return completed; }
    catch (error) { await db.from("ai_copilot_actions").update({ status: "FAILED", error_code: error instanceof Error ? error.message : "COPILOT_EXECUTION_FAILED" }).eq("id", actionId).eq("status", "CONFIRMED"); throw error; }
  }
  private async execute(plan: CopilotActionPlan, idempotencyKey: string): Promise<unknown> {
    const lines = requireLineProducts(plan); const date = isoDate(plan.documentDate); const currency = plan.currencyCode ?? "PKR"; const estimatePricing = new DefaultEstimatePricingService(this.pricing);
    if (plan.target === "estimate") {
      const customerId = positiveId(plan.customerId, "customerId"); const pricedLines = await Promise.all(lines.map((line, index) => estimatePricing.priceLine({ line_number: index + 1, product_id: line.productId, quantity: line.quantity, unit: line.unit ?? "unit", ...(line.rate !== undefined ? { unit_price: line.rate } : {}), ...(line.rateListId !== undefined ? { rate_list_id: line.rateListId, rate_list_selection_source: "LINE_OVERRIDE" as const } : {}) }, { price_type: "SALE", as_of: date, customer_id: customerId })));
      return this.estimate.createDraft({ definition: { customer_id: customerId, estimate_number: plan.documentNumber ?? `AI-${Date.now()}`, issue_date: date, currency_code: currency, notes: plan.reason ?? null }, lines: pricedLines }, { source_type: sourceType(plan.source), source_reference: `ai-copilot:${idempotencyKey}` });
    }
    if (plan.target === "invoice") {
      const customerId = positiveId(plan.customerId, "customerId"); if (!plan.warehouseId) throw new Error("warehouseId is required for invoice"); const pricedLines = await Promise.all(lines.map((line, index) => estimatePricing.priceLine({ line_number: index + 1, product_id: line.productId, quantity: line.quantity, unit: line.unit ?? "unit", ...(line.rate !== undefined ? { unit_price: line.rate } : {}), ...(line.rateListId !== undefined ? { rate_list_id: line.rateListId, rate_list_selection_source: "LINE_OVERRIDE" as const } : {}) }, { price_type: "SALE", as_of: date, customer_id: customerId }))); const subtotal = pricedLines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0); const invoice: InvoiceDocument = buildDirectInvoice({ invoice_number: plan.documentNumber ?? `AI-${Date.now()}`, customer_id: customerId, issue_date: date, currency_code: currency, notes: plan.reason ?? null }, pricedLines, subtotal, 0, subtotal, 0); const transactionLines: SalesTransactionLine[] = pricedLines.map((line, index) => ({ line_number: index + 1, product_id: line.product_id, quantity: line.quantity, unit: line.unit, unit_price: line.unit_price, line_total: line.quantity * line.unit_price, unit_cost: null, cogs_total: null })); return this.salesTransaction.execute({ invoice, warehouse_id: plan.warehouseId, lines: transactionLines, idempotency_key: idempotencyKey });
    }
    if (plan.target === "supplier_bill") {
      const vendorId = positiveId(plan.vendorId, "vendorId"); if (!plan.warehouseId) throw new Error("warehouseId is required for supplier bill"); const purchaseLines = await Promise.all(lines.map(async (line) => { let unitCost = line.rate; if (unitCost === undefined) { const resolved = await this.pricing.resolvePrice({ product_id: line.productId, quantity: line.quantity, price_type: "PURCHASE", as_of: date, vendor_id: vendorId, rate_list_id: line.rateListId ?? null }); if (!resolved) throw new Error(`no applicable purchase price found for product_id ${line.productId}`); unitCost = resolved.unit_price; } return { product_id: line.productId, quantity: line.quantity, unit_cost: unitCost }; }));
      const purchaseInput = { vendor_id: vendorId, warehouse_id: plan.warehouseId, items: purchaseLines, purchase_date: date, ...(plan.documentNumber !== undefined ? { invoice_number: plan.documentNumber } : {}), ...(plan.reason !== undefined ? { notes: plan.reason } : {}) }; return this.erp.recordPurchase(purchaseInput, { principalScope: plan.organizationId, operation: "purchase.create", idempotencyKey, requestFingerprint: copilotFingerprint(plan) });
    }
    if (plan.target === "customer_return") {
      const customerId = positiveId(plan.customerId, "customerId"); if (!plan.documentNumber) throw new Error("documentNumber must contain the source invoice id for customer return"); const invoiceId = positiveId(plan.documentNumber, "invoiceId"); if (!plan.warehouseId) throw new Error("warehouseId is required for customer return"); if (!plan.reason?.trim()) throw new Error("reason is required for customer return"); if (lines.some((line) => line.sourceItemId === undefined)) throw new Error("sourceItemId is required for every customer return line"); return this.returns.recordSalesReturn({ credit_note_number: `CN-${Date.now()}`, invoice_id: invoiceId, customer_id: customerId, credit_date: date, currency_code: currency, reason: plan.reason, items: lines.map((line) => ({ invoice_item_id: line.sourceItemId!, warehouse_id: plan.warehouseId!, quantity: line.quantity })) }, { principalScope: plan.organizationId, operation: "sales-return.create", idempotencyKey, requestFingerprint: copilotFingerprint(plan) });
    }
    if (plan.target === "inventory_adjustment") {
      if (!plan.warehouseId) throw new Error("warehouseId is required for inventory adjustment"); if (!plan.reason?.trim()) throw new Error("reason is required for inventory adjustment"); if (lines.length !== 1) throw new Error("inventory adjustment requires exactly one line"); const line = lines[0]!; const { data, error } = await client().rpc("record_inventory_adjustment", { p_product_id: line.productId, p_warehouse_id: plan.warehouseId, p_new_quantity: line.quantity, p_reason: plan.reason, p_principal_id: plan.userId, p_idempotency_key: idempotencyKey, p_request_fingerprint: copilotFingerprint(plan) }); if (error) throw error; return data;
    }
    throw new Error(`Unsupported Copilot intent: ${plan.target}`);
  }
}
