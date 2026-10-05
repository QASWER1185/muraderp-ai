import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import type { PermissionCode } from "../../auth/authorization.types.js";
import type { ErpService } from "../../services/erp.service.js";
import type { CopilotBusinessRepository } from "../../repositories/copilot-business.repository.js";
import type { CustomerPaymentBrowserRepository } from "../../repositories/customer-payment-browser.repository.js";
import type { VendorPaymentBrowserRepository } from "../../repositories/vendor-payment-browser.repository.js";
import { DefaultEstimateProfitService } from "../../services/estimate-profit.service.js";
import { calculateEstimateTotals } from "../../services/estimate.service.js";
import type { ResolvedPrice } from "../../types/pricing.types.js";
import type { AgentScope, ToolServices } from "./erp-tools.js";
import type { BusinessState } from "./business-state.js";
import { customerPaymentSchema, vendorPaymentSchema, paymentStateSchema, type PaymentPreparation } from "./payment-state.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const query = z.string().trim().min(1).max(120);
const limit = z.number().int().min(1).max(20).default(10);
const cursor = id.optional();
const product = { product_id: id.optional(), query: query.optional() };
const quantity = z.number().finite().positive().max(1_000_000).optional();
const discount = z.number().finite().min(0).max(100).optional();
const schemas = {
  lookup_vendors: z.strictObject({ query, limit }),
  query_customer_ledger: z.strictObject({ customer_id: id.optional(), query: query.optional(), limit, before_id: cursor }),
  query_inventory: z.strictObject({ ...product, warehouse_id: id.optional(), balance_scope: z.enum(["organization", "branch"]).default("organization"), limit, cursor, movement_cursor: cursor }),
  calculate_margin: z.strictObject({ ...product, quantity, discount_percent: discount }),
  compare_products: z.strictObject({ queries: z.array(query).min(2).max(5).optional(), metric: z.enum(["sale_price", "purchase_cost", "profit", "margin", "stock"]), quantity, discount_percent: discount }),
  list_payment_documents: z.strictObject({ party_type: z.enum(["customer", "vendor"]), party_id: id.optional(), limit, cursor }),
  prepare_customer_payment: customerPaymentSchema.omit({ customer_id: true }).extend({ customer_id: id.optional() }).strict(),
  prepare_vendor_payment: vendorPaymentSchema.omit({ vendor_id: true }).extend({ vendor_id: id.optional() }).strict(),
};
const descriptions: Record<keyof typeof schemas, string> = {
  lookup_vendors: "Indexed conservative vendor resolution in this organization and authorized branch. Choose only resolved bestCandidate.",
  query_customer_ledger: "Read the customer's complete branch subledger balance by currency, bounded recent debit/credit transactions and linked posted journals, and latest payment independently of the history page. Resolve query or use verified customer context; no guessed balances.",
  query_inventory: "Read authoritative ORGANIZATION/WAREHOUSE inventory balances and branch-filtered movement history for a resolved product. Branch on-hand is unsupported in the current ERP. Missing rows are unavailable, not zero. Pages are not total stock. Use context for pronouns.",
  calculate_margin: "Deterministic estimated profit and margin using current sale and active PURCHASE rate-book cost. This cost basis is an estimate, not realized COGS. Missing/ambiguous costs or incompatible currency/unit yield unavailable. Optional quantity and discount_percent are user choices; omit to reuse prior analysis choices.",
  compare_products: "Compare 2–5 products resolved separately by indexed query (include brand, size and product), or reuse the verified comparison set for 'both'. Metrics sale_price/purchase_cost/profit/margin/stock. No winner with missing values, mixed units or currencies, or incomplete stock pages. Prices are re-read on every call.",
  list_payment_documents: "Read bounded scoped receivables/payables for the verified customer/vendor before payment preparation. Ask the user to specify amount, date, method, currency (customer), and invoice/purchase allocations. Never silently choose payment allocations.",
  prepare_customer_payment: "Prepare a signed conversational CUSTOMER RECEIPT review only, with explicit allocations equal to amount. Independently validate party, currency and remaining invoice balances. User must click Prepare then explicitly Confirm through existing approval workflow. No execution or posting. Do not use for paying a customer refund.",
  prepare_vendor_payment: "Prepare a signed conversational VENDOR PAYMENT review only, with explicit allocations equal to amount. Validate scoped vendor and remaining purchase balances. Existing vendor domain has no currency field; do not infer one. User must Prepare then explicitly Confirm; no execution or posting.",
};
export const BUSINESS_TOOL_DEFINITIONS = Object.entries(schemas).map(([name, schema]) => ({ type: "function" as const, name, description: descriptions[name as keyof typeof schemas], strict: false, parameters: z.toJSONSchema(schema) }));
export type BusinessServices = {
  erp: Pick<ErpService, "getVendor" | "getWarehouse" | "listInventory" | "listStockMovements">;
  repository: CopilotBusinessRepository;
  customers: Pick<CustomerPaymentBrowserRepository, "listReceivables">;
  vendors: Pick<VendorPaymentBrowserRepository, "listPayables">;
};
export type BusinessFact = { kind: string; [key: string]: unknown };
type Reference = { id: number; name: string; sku: string; unit: string };
function clarification(message: string): never { throw new ApiError(422, "BUSINESS_CONTEXT_REQUIRED", message); }
const unitKey = (value: string) => value.trim().toUpperCase();

export class BusinessIntelligenceTools {
  constructor(private readonly base: ToolServices, private readonly services: BusinessServices) {}
  handles(name: string): name is keyof typeof schemas { return Object.hasOwn(schemas, name); }
  private async authorize(scope: AgentScope, permissions: PermissionCode[], signal?: AbortSignal) {
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and tenant scope are required.");
    await this.base.tenant.assertBranchAccess(scope, scope.branchId);
    signal?.throwIfAborted();
    for (const permission of permissions) {
      await this.base.tenant.assertPermission(scope, permission);
      signal?.throwIfAborted();
    }
  }
  private async resolveProduct(input: { product_id?: number | undefined; query?: string | undefined }, scope: AgentScope, state: BusinessState, signal?: AbortSignal): Promise<Reference> {
    let selected = input.product_id;
    if (input.query) {
      if (selected !== undefined) clarification("Use a product query or a verified ID, not both.");
      const resolution = await this.base.search.searchProducts(input.query, 5, scope);
      signal?.throwIfAborted();
      if (resolution.resolution !== "resolved" || !resolution.bestCandidate) {
        delete state.productContext; state.productUnresolved = true;
        clarification("Please identify the product by name, SKU, brand or size" + (resolution.items.length ? ": " + resolution.items.map(p => `${p.name} (ID ${p.id})`).join("; ") : "; no matching ERP product is available."));
      }
      selected = resolution.bestCandidate.id;
    } else {
      if (state.productUnresolved || state.productContext?.ambiguous) clarification("Please clarify the product before requesting business data.");
      selected ??= state.productContext?.candidates.length === 1 ? state.productContext.candidates[0]?.id : undefined;
      if (selected && state.productContext?.candidates.length === 1 && selected !== state.productContext.candidates[0]?.id) clarification("The product ID does not match the verified conversation. Resolve the new product first.");
    }
    if (!selected) clarification("Which product do you mean? Please provide its name or SKU.");
    const record = await this.base.erp.getProduct(selected, scope.organizationId);
    signal?.throwIfAborted();
    if (!record) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Product unavailable in this organization.");
    return { id: record.id, name: record.name.slice(0, 160), sku: record.sku.slice(0, 100), unit: record.unit.slice(0, 30) };
  }
  private async party(kind: "customer" | "vendor", selected: number | undefined, scope: AgentScope, state: BusinessState, signal?: AbortSignal) {
    if (kind === "customer" ? state.customerAmbiguous : state.vendorAmbiguous) clarification(`Please clarify which ${kind} you mean.`);
    const context = kind === "customer" ? state.customer : state.vendor;
    selected ??= context?.id;
    if (!selected) clarification(`Please identify the ${kind} first.`);
    if (context && selected !== context.id) clarification(`The ${kind} ID does not match the verified conversation. Resolve the new party first.`);
    const record = kind === "customer" ? await this.base.erp.getCustomer(selected, scope.organizationId) : await this.services.erp.getVendor(selected, scope.organizationId);
    signal?.throwIfAborted();
    if (!record) throw new ApiError(404, "PARTY_NOT_FOUND", `${kind} unavailable in this organization.`);
    const reference = { id: record.id, name: record.name.slice(0, 160) };
    if (kind === "customer") state.customer = reference;
    else state.vendor = reference;
    return reference;
  }
  private rememberProduct(state: BusinessState, reference: Reference) {
    state.productContext = { candidates: [reference], ambiguous: false }; state.productUnresolved = false;
  }
  private async inventory(reference: Reference, scope: AgentScope, input: z.output<typeof schemas.query_inventory>, signal?: AbortSignal): Promise<BusinessFact> {
    if (input.warehouse_id !== undefined) {
      const warehouse = await this.services.erp.getWarehouse(input.warehouse_id, scope.organizationId);
      signal?.throwIfAborted();
      if (!warehouse) throw new ApiError(404, "WAREHOUSE_NOT_FOUND", "Warehouse unavailable in this organization.");
    }
    const filters = { limit: input.limit, product_id: reference.id, ...(input.warehouse_id === undefined ? {} : { warehouse_id: input.warehouse_id }), ...(input.cursor === undefined ? {} : { cursor: input.cursor }) };
    const balances = input.balance_scope === "branch" ? null : await this.services.erp.listInventory(filters, scope.organizationId);
    signal?.throwIfAborted();
    // Balance and movement cursors are different orders; expose history separately
    // and do not apply the balance cursor to movement history.
    const movements = await this.services.erp.listStockMovements({ limit: input.limit, product_id: reference.id,
      ...(input.warehouse_id === undefined ? {} : { warehouse_id: input.warehouse_id }),
      ...(input.movement_cursor === undefined ? {} : { cursor: input.movement_cursor }) }, scope.organizationId, scope.branchId);
    signal?.throwIfAborted();
    const rows = balances?.data.map(row => ({ warehouseId: row.warehouse_id, quantity: Number(row.quantity), unit: reference.unit })) ?? [];
    return { kind: "inventory", product: reference, balanceScope: "ORGANIZATION_WAREHOUSE", branchOnHand: null,
      branchStatus: "unsupported", branchReason: "ERP inventory and warehouses have no branch attribution; branch movements cannot establish current on-hand.",
      status: input.balance_scope === "branch" ? "unsupported" : rows.length ? "available" : "unavailable",
      balances: rows, totalQuantity: balances && rows.length && balances.next_cursor === null && input.cursor === undefined ? rows.reduce((sum, row) => sum + row.quantity, 0) : null,
      nextCursor: balances?.next_cursor ?? null,
      movements: movements.data.map(row => ({ id: row.id, warehouseId: row.warehouse_id, type: row.movement_type, quantity: row.quantity, date: row.created_at, referenceType: row.reference_type, referenceId: row.reference_id })),
      movementNextCursor: movements.next_cursor, movementScope: "BRANCH" };
  }
  private async prices(reference: Reference, scope: AgentScope, state: BusinessState, qty: number, includeCost: boolean, signal?: AbortSignal) {
    if (state.customerAmbiguous) clarification("Please clarify the customer before requesting applicable prices.");
    const asOf = new Date().toISOString();
    const customer = state.customer ? await this.party("customer", state.customer.id, scope, state, signal) : undefined;
    const resolve = async (type: "SALE" | "PURCHASE") => {
      try {
        const value = await this.base.pricing.resolvePrice({ organization_id: scope.organizationId, product_id: reference.id, quantity: qty, price_type: type, as_of: asOf,
          ...(type === "SALE" && customer ? { customer_id: customer.id } : {}), ...(type === "SALE" && state.rateListId ? { rate_list_id: state.rateListId } : {}) });
        signal?.throwIfAborted();
        if (value && (value.product_id !== reference.id || !Number.isFinite(value.unit_price) || value.unit_price < 0)) throw new Error("Invalid authoritative price");
        return { value, status: value ? "available" : "unavailable" };
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof ApiError && [401,403].includes(error.status)) throw error;
        if (error instanceof Error && error.message.startsWith("Ambiguous pricing:")) return { value: null, status: "ambiguous" };
        throw error;
      }
    };
    // A selected sale list must be scoped/applicable just as in the rate tool.
    if (state.rateListId) {
      const list = (await this.base.rateLists.listActiveSaleRateLists(scope.organizationId)).find(row => row.id === state.rateListId);
      signal?.throwIfAborted();
      if (!list || list.scope_type === "VENDOR" || (list.scope_type === "CUSTOMER" && list.customer_id !== customer?.id)) throw new ApiError(403, "RATE_LIST_ACCESS_DENIED", "Sale rate list is not applicable.");
    }
    const sale = await resolve("SALE");
    const cost = includeCost ? await resolve("PURCHASE") : { value: null, status: "not_requested" };
    return { sale, cost, asOf };
  }
  private async margin(reference: Reference, scope: AgentScope, state: BusinessState, qty: number, discountPercent: number, signal?: AbortSignal): Promise<BusinessFact> {
    const { sale, cost, asOf } = await this.prices(reference, scope, state, qty, true, signal);
    const compatibleSale = sale.value && unitKey(sale.value.unit) === unitKey(reference.unit);
    const compatibleCost = compatibleSale && cost.value && unitKey(cost.value.unit) === unitKey(sale.value!.unit) && cost.value.currency_code === sale.value!.currency_code;
    const revenue = compatibleSale ? Math.round(qty * sale.value!.unit_price * 100) / 100 : null;
    const discountAmount = revenue === null ? null : Math.min(revenue, Math.round(revenue * discountPercent) / 100);
    const netRevenue = revenue === null ? null : Math.round(calculateEstimateTotals([{ line_number: 1, product_id: reference.id,
      quantity: qty, unit: reference.unit, unit_price: sale.value!.unit_price, discount_amount: discountAmount!, pricing_source: "RESOLVED_RATE" }]).grand_total * 100) / 100;
    const netUnitPrice = netRevenue === null ? null : netRevenue / qty;
    const summary = netUnitPrice === null ? null : await new DefaultEstimateProfitService({ resolveEstimatedCost: async () => compatibleCost ? cost.value!.unit_price : null }).analyze([
      { line_number: 1, product_id: reference.id, quantity: qty, unit: reference.unit, unit_price: netUnitPrice, pricing_source: "RESOLVED_RATE" },
    ], asOf);
    signal?.throwIfAborted();
    const profit = summary?.lines[0]?.estimated_profit_loss;
    return { kind: "margin", product: reference, quantity: qty, discountPercent, saleRate: sale.value, purchaseCost: cost.value,
      saleStatus: sale.status, costStatus: cost.status, costBasis: "ACTIVE_PURCHASE_RATE_ESTIMATE", asOf, currencyCode: compatibleSale ? sale.value!.currency_code : null,
      status: compatibleCost ? "available" : "unavailable", reason: !sale.value ? "Authoritative sale rate " + sale.status : !cost.value ? "Authoritative purchase cost " + cost.status : !compatibleCost ? "Currency or unit mismatch; conversion is unsupported." : null,
      revenue: netRevenue, discountAmount, estimatedCost: summary?.total_estimated_cost ?? null,
      grossProfit: profit === undefined || profit === null ? null : Math.round(profit * 100) / 100, marginPercent: summary?.expected_margin_percent ?? null };
  }
  async validatePayment(preparation: PaymentPreparation, scope: AgentScope, state: BusinessState, signal?: AbortSignal) {
    this.assertStateScope(state, scope);
    await this.authorize(scope, ["payments.create", preparation.intent === "customer_payment" ? "customers.read" : "vendors.read", preparation.intent === "customer_payment" ? "sales.read" : "purchases.read"], signal);
    const parsed = paymentStateSchema.parse(preparation);
    const isCustomer = parsed.intent === "customer_payment";
    const party = await this.party(isCustomer ? "customer" : "vendor", isCustomer ? parsed.payment.customer_id : parsed.payment.vendor_id, scope, state, signal);
    const allocations = parsed.payment.allocations;
    const keys = allocations.map(row => "invoice_id" in row ? row.invoice_id : row.purchase_id);
    if (new Set(keys).size !== keys.length || Math.abs(allocations.reduce((sum, row) => sum + row.amount, 0) - parsed.payment.amount) > 0.000001) throw new ApiError(422, "PAYMENT_ALLOCATION_INVALID", "Distinct allocations must equal the payment amount.");
    const rows = isCustomer
      ? (await this.services.customers.listReceivables(scope.organizationId, scope.branchId, 20, undefined, { customerId: party.id, invoiceIds: keys })).data
      : (await this.services.vendors.listPayables(scope.organizationId, scope.branchId, 20, undefined, { vendorId: party.id, purchaseIds: keys })).data;
    signal?.throwIfAborted();
    for (const [index, key] of keys.entries()) {
      const row = rows.find(value => ("invoice_id" in value ? value.invoice_id : value.purchase_id) === key);
      if (!row || ("customer_id" in row ? row.customer_id : row.vendor_id) !== party.id || !Number.isFinite(row.outstanding) || allocations[index]!.amount > row.outstanding + 0.000001 ||
          (isCustomer && (!('currency_code' in row) || row.currency_code !== parsed.payment.currency_code))) throw new ApiError(422, "PAYMENT_ALLOCATION_INVALID", "Allocation is unavailable, belongs to another party/scope, has incompatible currency, or exceeds the remaining balance.");
    }
    return { ...parsed, partyName: party.name };
  }
  async execute(name: keyof typeof schemas, raw: unknown, scope: AgentScope, state: BusinessState, signal?: AbortSignal): Promise<unknown> {
    this.assertStateScope(state, scope);
    const permissions: PermissionCode[] = name === "lookup_vendors" ? ["vendors.read"] : name === "query_customer_ledger" ? ["accounting.read", "customers.read"] : name === "query_inventory" ? ["products.read", "inventory.read"] : name === "calculate_margin" ? ["products.read", "sales.read", "purchases.read"] : name === "compare_products" ? ["products.read"] : name === "list_payment_documents" ? ["payments.create"] : ["payments.create"];
    await this.authorize(scope, permissions, signal);
    const candidate = structuredClone(state);
    const checked = <K extends keyof typeof schemas>(key: K): z.output<(typeof schemas)[K]> => {
      const parsed = schemas[key].safeParse(raw);
      if (!parsed.success) throw new ApiError(400, "INVALID_COPILOT_TOOL_INPUT", "Business tool arguments are invalid.");
      return parsed.data as z.output<(typeof schemas)[K]>;
    };
    let result: unknown;
    if (name === "lookup_vendors") {
      const input = checked(name);
      const resolution = await this.services.repository.searchVendors(scope, input.query, input.limit);
      candidate.vendorAmbiguous = resolution.resolution !== "resolved";
      if (!candidate.vendorAmbiguous && resolution.bestCandidate) candidate.vendor = { id: resolution.bestCandidate.id, name: resolution.bestCandidate.name.slice(0, 160) };
      else delete candidate.vendor;
      result = resolution;
    } else if (name === "query_customer_ledger") {
      const input = checked(name);
      if (input.query) {
        if (input.customer_id !== undefined) clarification("Use a customer query or verified ID, not both.");
        const resolution = await this.base.search.searchCustomers(input.query, 5, scope);
        signal?.throwIfAborted();
        if (resolution.resolution !== "resolved" || !resolution.bestCandidate) clarification("Please clarify the customer by name or location: " + resolution.items.map(row => row.name + " (ID " + row.id + ")").join("; "));
        candidate.customer = { id: resolution.bestCandidate.id, name: resolution.bestCandidate.name.slice(0,160) }; candidate.customerAmbiguous = false;
      }
      const party = await this.party("customer", input.customer_id, scope, candidate, signal);
      const ledger = await this.services.repository.customerLedger(scope, party.id, input.limit, input.before_id);
      result = { kind: "customer_ledger", customer: party, ledgerScope: "BRANCH", status: ledger.balances.length ? "available" : "empty", ...ledger };
    } else if (name === "query_inventory" || name === "calculate_margin") {
      const input = name === "query_inventory" ? checked(name) : checked("calculate_margin");
      const reference = await this.resolveProduct(input, scope, candidate, signal);
      this.rememberProduct(candidate, reference);
      if (name === "query_inventory") result = await this.inventory(reference, scope, input as z.output<typeof schemas.query_inventory>, signal);
      else {
        const analysis = input as z.output<typeof schemas.calculate_margin>;
        const prior = candidate.analysis?.productId === reference.id ? candidate.analysis : undefined;
        const qty = analysis.quantity ?? prior?.quantity ?? 1; const percent = analysis.discount_percent ?? prior?.discountPercent ?? 0;
        if (candidate.customer) await this.authorize(scope, ["customers.read"], signal);
        result = await this.margin(reference, scope, candidate, qty, percent, signal);
        candidate.analysis = { productId: reference.id, quantity: qty, discountPercent: percent };
      }
    } else if (name === "compare_products") {
      const input = checked(name);
      await this.authorize(scope, input.metric === "stock" ? ["inventory.read"] : input.metric === "sale_price" ? ["sales.read"] : ["sales.read", "purchases.read"], signal);
      if (candidate.customer && input.metric !== "stock") await this.authorize(scope, ["customers.read"], signal);
      const references: Reference[] = [];
      if (input.queries) {
        for (const query of input.queries) references.push(await this.resolveProduct({ query }, scope, candidate, signal));
      } else {
        if (!candidate.comparison) clarification("Which products should I compare? Please give two or more product names with brand and size.");
        for (const ref of candidate.comparison) {
          // Stored comparison references are signed, but revalidate current ownership.
          const isolated = { ...candidate, productContext: undefined, productUnresolved: false };
          references.push(await this.resolveProduct({ product_id: ref.id }, scope, isolated, signal));
        }
      }
      if (new Set(references.map(ref => ref.id)).size !== references.length) clarification("Please choose distinct products for comparison.");
      const rows: BusinessFact[] = [];
      const prior = input.queries ? undefined : candidate.comparisonAnalysis;
      const qty = input.quantity ?? prior?.quantity ?? 1; const percent = input.discount_percent ?? prior?.discountPercent ?? 0;
      for (const ref of references) {
        if (input.metric === "stock") rows.push(await this.inventory(ref, scope, { limit: 20, balance_scope: "organization" }, signal));
        else if (input.metric === "sale_price") {
          const { sale } = await this.prices(ref, scope, candidate, qty, false, signal);
          const compatible = sale.value && unitKey(sale.value.unit) === unitKey(ref.unit);
          rows.push({ kind: "sale_price", product: ref, value: compatible ? sale.value!.unit_price : null, unit: sale.value?.unit ?? ref.unit, currencyCode: sale.value?.currency_code ?? null, status: compatible ? sale.status : "unavailable" });
        } else rows.push(await this.margin(ref, scope, candidate, qty, percent, signal));
      }
      const values = rows.map((row,index) => {
        if (input.metric === "stock") return row.totalQuantity;
        if (input.metric === "sale_price") return row.value;
        if (input.metric === "purchase_cost") {
          const cost = row.purchaseCost as ResolvedPrice | null;
          return cost && unitKey(cost.unit) === unitKey(references[index]!.unit) ? cost.unit_price : null;
        }
        return input.metric === "profit" ? row.grossProfit : row.marginPercent;
      });
      const units = rows.map((row,index) => input.metric === "sale_price" ? unitKey(String(row.unit)) : unitKey(references[index]!.unit));
      const currencies = rows.map(row => input.metric === "purchase_cost" ? (row.purchaseCost as ResolvedPrice | null)?.currency_code : row.currencyCode);
      const comparable = values.every(value => typeof value === "number" && Number.isFinite(value)) && new Set(units).size === 1 && (input.metric === "stock" || new Set(currencies).size === 1);
      const best = comparable ? (input.metric === "sale_price" || input.metric === "purchase_cost" ? Math.min(...values as number[]) : Math.max(...values as number[])) : null;
      result = { kind: "comparison", metric: input.metric, quantity: qty, discountPercent: percent, rows, values, status: comparable ? "available" : "unavailable", reason: comparable ? null : "Missing or incomplete data, or incompatible units/currencies; no reliable winner.", winners: best === null ? [] : references.filter((_,index) => values[index] === best), balanceScope: input.metric === "stock" ? "ORGANIZATION_WAREHOUSE" : undefined };
      candidate.comparison = references;
      candidate.comparisonAnalysis = { quantity: qty, discountPercent: percent };
    } else if (name === "list_payment_documents") {
      const input = checked(name);
      await this.authorize(scope, input.party_type === "customer" ? ["customers.read", "sales.read"] : ["vendors.read", "purchases.read"], signal);
      const party = await this.party(input.party_type, input.party_id, scope, candidate, signal);
      const documents = input.party_type === "customer" ? await this.services.customers.listReceivables(scope.organizationId,scope.branchId,input.limit,input.cursor,{customerId:party.id}) : await this.services.vendors.listPayables(scope.organizationId,scope.branchId,input.limit,input.cursor,{vendorId:party.id});
      result = { kind: "payment_documents", party, partyType: input.party_type, ...documents, requiresConfirmation: true, executed: false };
    } else {
      const input = name === "prepare_customer_payment" ? checked(name) : checked("prepare_vendor_payment");
      const kind = name === "prepare_customer_payment" ? "customer" : "vendor";
      await this.authorize(scope, kind === "customer" ? ["customers.read", "sales.read"] : ["vendors.read", "purchases.read"], signal);
      const party = await this.party(kind, "customer_id" in input ? input.customer_id : "vendor_id" in input ? input.vendor_id : undefined, scope, candidate, signal);
      const preparation = paymentStateSchema.parse(kind === "customer" ? { intent: "customer_payment", partyName: party.name, payment: { ...input, customer_id: party.id } } : { intent: "vendor_payment", partyName: party.name, payment: { ...input, vendor_id: party.id } });
      candidate.paymentPreparation = await this.validatePayment(preparation, scope, candidate, signal);
      result = { kind: "payment_preparation", ...candidate.paymentPreparation, requiresConfirmation: true, executed: false, currencyStatus: kind === "vendor" ? "unsupported_by_vendor_domain" : "validated" };
    }
    signal?.throwIfAborted();
    Object.assign(state, candidate);
    // Object.assign cannot remove optional fields cleared in the candidate.
    if (!candidate.vendor) delete state.vendor;
    return result;
  }
  private assertStateScope(state: BusinessState, scope: AgentScope) {
    if (state.userId !== scope.userId || state.organizationId !== scope.organizationId || state.branchId !== scope.branchId) {
      throw new ApiError(403, "BUSINESS_CONTEXT_SCOPE_MISMATCH", "Business context does not match the authenticated scope.");
    }
  }
}
