import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import { DefaultEstimatePricingService } from "../../services/estimate-pricing.service.js";
import { calculateEstimateTotals } from "../../services/estimate.service.js";
import type { PricedEstimateLine } from "../../types/estimate.types.js";
import type { ResolvedPrice } from "../../types/pricing.types.js";
import type { AgentScope, ToolServices } from "./erp-tools.js";
import { touchDraft, type BusinessState } from "./business-state.js";
import { rememberedDiscount } from "../customerMemoryStore.js";

const id = z.number().int().positive();
const quantity = z.number().finite().positive().max(1_000_000);
const discount = z.number().finite().min(0).max(100);
const lineId = z.string().uuid();
const schemas = {
  set_task_context: z.strictObject({ customer_id: id.optional(), brand_hint: z.string().trim().min(1).max(120).optional(), rate_list_id: id.optional() }),
  begin_estimate_draft: z.strictObject({}),
  add_draft_item: z.strictObject({ product_id: id.optional(), quantity, unit: z.string().trim().min(1).max(30).optional(), rate_list_id: id.optional(),rawShorthand:z.string().trim().min(1).max(200).optional(),size:z.string().trim().max(100).optional() }),
  remove_draft_item: z.strictObject({ line_id: lineId }),
  update_draft_quantity: z.strictObject({ line_id: lineId, quantity }),
  update_draft_discount: z.strictObject({ line_ids: z.array(lineId).min(1).max(20).optional(), percent: discount }),
  inspect_draft: z.strictObject({}),
  recalculate_draft: z.strictObject({}),
  prepare_estimate: z.strictObject({}),
};
const descriptions: Record<keyof typeof schemas, string> = {
  set_task_context: "Retain a resolved customer and the user's brand hint or an active sale rate list for this business task. Customer IDs must come from a resolved customer search. This changes conversation state only.",
  begin_estimate_draft: "Begin or continue the same lightweight estimate draft; never creates a duplicate draft or an ERP record.",
  add_draft_item: "Add a resolved product to the current estimate. Omit product_id only for exactly one unambiguous verified product. Quantities use the ERP unit; never guess unit conversions. Duplicate products with the same list/unit merge quantities.",
  remove_draft_item: "Remove one existing draft line by its stable line_id from inspect_draft.",
  update_draft_quantity: "Correct the quantity of an existing line identified by line_id. Replaces its quantity rather than appending a duplicate.",
  update_draft_discount: "Set a percentage discount on selected existing line_ids, or all lines when omitted. Server calculates amounts from current ERP rates.",
  inspect_draft: "Read the current draft, stable line_ids, quantities, discounts, verified customer, authoritative current rates and deterministic totals.",
  recalculate_draft: "Reprice the existing draft through ERP and calculate totals on the server. A missing rate is unavailable; never substitute a price.",
  prepare_estimate: "Prepare the complete current estimate for the existing explicit approval flow. No ERP record is written or executed. Customer, lines and rates must be verified.",
};
export const DRAFT_TOOL_DEFINITIONS = Object.entries(schemas).map(([name, schema]) => ({
  type: "function" as const, name, description: descriptions[name as keyof typeof schemas],
  strict: false, parameters: z.toJSONSchema(schema),
}));
export type DraftView = {
  id: string; revision: number; customer: BusinessState["customer"]; brandHint?: string;
  lines: Array<{ lineId: string; productId: number; productName: string; quantity: number; unit: string;
    discountPercent: number; rateListId?: number; rate: ResolvedPrice | null; amount: number | null; discountAmount: number | null; error?: string }>;
  currencyCode: string | null; totals: ReturnType<typeof calculateEstimateTotals> | null;
  requiresConfirmation: true; prepared: boolean;
};
type RateLookup = (input: unknown, scope: AgentScope, signal?: AbortSignal) => Promise<unknown>;
const unavailable = (message: string) => new ApiError(422, "DRAFT_CONTEXT_REQUIRED", message);

/** Owns only transient business state. This service has no database write/execution dependency. */
export class ConversationalDraftService {
  constructor(private readonly services: ToolServices, private readonly lookupRate: RateLookup) {}
  handles(name: string) { return Object.hasOwn(schemas, name); }
  async assertAccess(scope: AgentScope, signal?: AbortSignal) {
    signal?.throwIfAborted();
    await this.services.tenant.assertBranchAccess(scope, scope.branchId);
    signal?.throwIfAborted();
    await this.services.tenant.assertPermission(scope, "sales.create");
    signal?.throwIfAborted();
    await this.services.tenant.assertPermission(scope, "products.read");
    signal?.throwIfAborted();
  }
  async inspect(state: BusinessState, scope: AgentScope, signal?: AbortSignal): Promise<DraftView> {
    await this.assertAccess(scope, signal);
    if (!state.draft) throw unavailable("Begin an estimate draft first.");
    if (state.customerAmbiguous) throw unavailable("Please clarify which customer this draft is for.");
    if (state.customer) {
      await this.services.tenant.assertPermission(scope, "customers.read");
      signal?.throwIfAborted();
      const customer = await this.services.erp.getCustomer(state.customer.id, scope.organizationId);
      signal?.throwIfAborted();
      if (!customer) throw unavailable("The selected customer is no longer available in this organization.");
    }
    const priced: PricedEstimateLine[] = [];
    const lines: DraftView["lines"] = [];
    let currency: string | null = null;
    const estimatePricing = new DefaultEstimatePricingService({
      resolvePrice: async (input) => await this.lookupRate({
        product_id: input.product_id, quantity: input.quantity,
        ...(input.customer_id == null ? {} : { customer_id: input.customer_id }),
        ...(input.rate_list_id == null ? {} : { rate_list_id: input.rate_list_id }),
      }, scope, signal) as ResolvedPrice | null,
    });
    for (const [index, line] of state.draft.lines.entries()) {
      const product = await this.services.erp.getProduct(line.productId, scope.organizationId);
      signal?.throwIfAborted();
      if (!product) throw unavailable("A draft product is no longer available in this organization.");
      const row: DraftView["lines"][number] = { lineId: line.id, productId: line.productId, productName: product.name,
        quantity: line.quantity, unit: line.unit, discountPercent: line.discountPercent,
        ...(line.rateListId ? { rateListId: line.rateListId } : {}), rate: null, amount: null, discountAmount: null };
      try {
        const quoted = await estimatePricing.priceLine({
          line_number: index + 1, product_id: line.productId, quantity: line.quantity, unit: line.unit,
          ...(line.rateListId ? { rate_list_id: line.rateListId } : {}),
        }, { organization_id: scope.organizationId, customer_id: state.customer?.id, price_type: "SALE", as_of: new Date().toISOString() });
        signal?.throwIfAborted();
        if (quoted.unit.toLocaleLowerCase() !== line.unit.toLocaleLowerCase()) throw unavailable("The requested unit differs from the rate unit. Please clarify the quantity/unit.");
        const resolved = quoted.resolved_price!;
        if(this.services.memory && state.customer && line.discountSource!=="user" && line.memoryCustomerId!==state.customer.id) {
          const profile=await this.services.memory.recall(scope,state.customer.id,state.customer.name);
          line.discountPercent=rememberedDiscount(profile,product,line.unit,resolved.currency_code);
          line.discountSource="memory";line.memoryCustomerId=state.customer.id;row.discountPercent=line.discountPercent;
        }
        if (!Number.isFinite(resolved.unit_price) || resolved.unit_price < 0) throw new Error("Invalid ERP rate");
        if (currency && currency !== resolved.currency_code) throw unavailable("Draft lines use different currencies. Choose one compatible rate list.");
        currency = resolved.currency_code;
        const gross = line.quantity * quoted.unit_price;
        const discountAmount = Math.min(gross, Math.round(gross * line.discountPercent) / 100);
        await this.services.memory?.assertFloor(scope,product.id,quoted.unit_price,gross===0?0:discountAmount/gross*100,line.unit,resolved.currency_code);
        if (!Number.isFinite(gross)) throw unavailable("The draft amount is too large.");
        row.rate = resolved; row.discountAmount = discountAmount; row.amount = gross - discountAmount;
        priced.push({ ...quoted, discount_amount: discountAmount });
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
        if (error instanceof ApiError && ["DISCOUNT_BELOW_COST","PURCHASE_BASELINE_REQUIRED","PURCHASE_MEMORY_UNAVAILABLE"].includes(error.code)) throw error;
        row.error = error instanceof ApiError ? error.message : "No verified current sale rate is available. Clarify the applicable rate list.";
      }
      lines.push(row);
    }
    return { id: state.draft.id, revision: state.draft.revision, customer: state.customer,
      ...(state.brandHint ? { brandHint: state.brandHint } : {}), lines, currencyCode: currency,
      totals: lines.length > 0 && priced.length === lines.length ? calculateEstimateTotals(priced) : null,
      requiresConfirmation: true, prepared: state.draft.preparedRevision === state.draft.revision };
  }
  async execute(name: string, raw: unknown, scope: AgentScope, state: BusinessState, signal?: AbortSignal): Promise<DraftView | { contextUpdated: true }> {
    const schema = schemas[name as keyof typeof schemas];
    if (!schema) throw unavailable("This draft capability is unavailable.");
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, "INVALID_COPILOT_TOOL_INPUT", "Draft tool arguments are invalid.");
    await this.assertAccess(scope, signal);
    const candidate = structuredClone(state);
    const args = parsed.data as Record<string, any>;
    if (name === "set_task_context") {
      if (args.customer_id !== undefined && (candidate.customerAmbiguous || candidate.customer?.id !== args.customer_id)) {
        throw unavailable("Resolve the customer with lookup_customers before selecting its ID.");
      }
      if (args.brand_hint !== undefined) candidate.brandHint = args.brand_hint;
      if (args.rate_list_id !== undefined) {
        await this.services.tenant.assertPermission(scope, "sales.read");
        const lists = await this.services.rateLists.listActiveSaleRateLists(scope.organizationId);
        signal?.throwIfAborted();
        if (!lists.some(list => list.id === args.rate_list_id && list.scope_type !== "VENDOR" &&
          (list.scope_type !== "CUSTOMER" || list.customer_id === candidate.customer?.id))) {
          throw new ApiError(403, "RATE_LIST_ACCESS_DENIED", "The selected rate list is not available to this customer.");
        }
        candidate.rateListId = args.rate_list_id;
      }
      if (candidate.draft) touchDraft(candidate);
      Object.assign(state, candidate);
      return { contextUpdated: true };
    }
    if (name === "begin_estimate_draft") {
      if (!candidate.draft) touchDraft(candidate);
    } else if (!candidate.draft) throw unavailable("Begin an estimate draft first.");
    if (name === "add_draft_item") {
      if (candidate.productUnresolved || candidate.productContext?.ambiguous) throw unavailable("Please clarify the product before adding it.");
      const productId = args.product_id ?? (candidate.productContext?.candidates.length === 1 ? candidate.productContext.candidates[0]!.id : undefined);
      if (!productId || (!candidate.productContext?.candidates.some(p => p.id === productId) &&
          !candidate.draft!.lines.some(line => line.productId === productId))) throw unavailable("Resolve the product before adding it.");
      const product = await this.services.erp.getProduct(productId, scope.organizationId);
      signal?.throwIfAborted();
      if (!product) throw unavailable("The product is unavailable in this organization.");
      const requestedUnit = args.unit ?? product.unit;
      if (requestedUnit.toLocaleLowerCase() !== product.unit.toLocaleLowerCase()) throw unavailable("Use the verified ERP unit or clarify the conversion.");
      const unit = product.unit;
      const profile = candidate.customer && this.services.memory ? await this.services.memory.recall(scope,candidate.customer.id,candidate.customer.name) : undefined;
      const rate = profile ? await this.lookupRate({product_id:productId,customer_id:candidate.customer!.id,quantity:args.quantity,...((args.rate_list_id??candidate.rateListId)?{rate_list_id:args.rate_list_id??candidate.rateListId}:{})},scope,signal) as ResolvedPrice|null : null;
      const discountPercent = profile && rate ? rememberedDiscount(profile,product,unit,rate.currency_code) : 0;
      const rateListId = args.rate_list_id ?? candidate.rateListId;
      const draft = touchDraft(candidate);
      const existing = draft.lines.find(line => line.productId === productId && line.unit === unit && line.rateListId === rateListId);
      if (existing) {
        if (existing.quantity + args.quantity > 1_000_000) throw unavailable("The quantity exceeds the draft limit.");
        existing.quantity += args.quantity;
      } else {
        if (draft.lines.length >= 20) throw unavailable("A conversational draft supports at most 20 lines.");
        draft.lines.push({ id: randomUUID(), productId, quantity: args.quantity, unit, discountPercent,
          discountSource:"memory",...(candidate.customer?{memoryCustomerId:candidate.customer.id}:{}),
          ...(args.rawShorthand?{rawShorthand:args.rawShorthand}:{}),...(args.size?{size:args.size}:{}),
          ...(rateListId ? { rateListId } : {}) });
      }
    }
    if (name === "remove_draft_item" || name === "update_draft_quantity") {
      const line = candidate.draft!.lines.find(item => item.id === args.line_id);
      if (!line) throw unavailable("Choose an existing draft line from inspect_draft.");
      const draft = touchDraft(candidate);
      if (name === "remove_draft_item") draft.lines = draft.lines.filter(item => item.id !== args.line_id);
      else line.quantity = args.quantity;
    }
    if (name === "update_draft_discount") {
      const selected = args.line_ids ?? candidate.draft!.lines.map(line => line.id);
      if (!selected.length || selected.some((selectedId: string) => !candidate.draft!.lines.some(line => line.id === selectedId))) {
        throw unavailable("Choose existing draft lines before applying a discount.");
      }
      touchDraft(candidate).lines.forEach(line => { if (selected.includes(line.id)) {line.discountPercent = args.percent;line.discountSource="user";} });
    }
    if (name === "recalculate_draft") touchDraft(candidate);
    const view = await this.inspect(candidate, scope, signal);
    if (name === "prepare_estimate") {
      if (!candidate.customer || !view.totals || !view.lines.length || view.lines.some(line => !line.rate)) {
        throw unavailable("A verified customer, at least one line and current ERP rates are required before preparing the estimate.");
      }
      candidate.draft!.preparedRevision = candidate.draft!.revision;
      view.prepared = true;
    }
    signal?.throwIfAborted();
    Object.assign(state, candidate);
    return view;
  }
}

export function draftAnswer(view: DraftView, _message = ""): string {
  const rows = view.lines.map(line => `${line.productName}: ${line.quantity} ${line.unit}، رعایت ${line.discountPercent}% — ${line.amount == null ? "اس لائن کا درست نرخ یا یونٹ واضح کر دیں۔" : view.currencyCode + " " + line.amount.toFixed(2)}`);
  return [view.customer ? "گاہک: " + view.customer.name : "براہ کرم گاہک کی شناخت واضح کریں۔",
    ...rows, view.totals ? `کل رقم: ${view.currencyCode} ${view.totals.grand_total.toFixed(2)}` : "تمام ریٹس کی تصدیق تک کل رقم دستیاب نہیں۔",
    view.prepared ? "ایسٹیمیٹ کا مکمل پری ویو تیار ہے؛ محفوظ کرنے کے لیے آخر میں منظوری دے دیں۔" :
      "اسی گفتگو کا مسودہ اپ ڈیٹ ہوگیا ہے؛ ERP میں کوئی ریکارڈ نہیں لکھا گیا۔"].join("\n");
}
