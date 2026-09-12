import { createHash } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { AuthorizationService } from "../auth/authorization.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { SupabaseAuthorizationGateway, createAuthorizationClient } from "../auth/supabase-authorization.gateway.js";
import { env } from "../config/env.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { DefaultEstimateService, type EstimateService } from "../services/estimate.service.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { DefaultEstimatePricingService } from "../services/estimate-pricing.service.js";
import { DefaultPricingService, type PricingService } from "../services/pricing.service.js";
import { SupabaseRateListRepository } from "../repositories/rate-list.repository.js";
import { DefaultRateListService, type RateListService } from "../services/rate-list.service.js";
import { SupabaseCustomerPaymentService, type CustomerPaymentInput, type CustomerPaymentService } from "../services/customer-payment.service.js";
import { SupabaseVendorPaymentService, type VendorPaymentInput, type VendorPaymentService } from "../services/vendor-payment.service.js";
import { SupabaseSalesTransactionAdapter } from "../services/supabase-sales-transaction.adapter.js";
import { SupabaseSalesReturnService, type SalesReturnService } from "../services/sales-return.service.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { buildDirectInvoice, type InvoiceDocument } from "../types/invoice.types.js";
import type { SalesTransactionLine, SalesTransactionPort } from "../types/sales-transaction.types.js";
import type { RateListSelectionSource } from "../types/pricing.types.js";
import type { AiDraft } from "../ai-input/contracts.js";
import type { CopilotActionPlan } from "./copilot.types.js";
import { createCopilotPlanFromDraft, assertCopilotDraftExecution } from "./copilot.service.js";
import {
  SupabaseCopilotReferenceResolver,
  type CopilotReferenceResolver,
} from "./copilot-reference.resolver.js";
import { OpenAiProvider, ProviderIntentResolver } from "../ai-input/openai.provider.js";
import {
  CopilotReviewService,
  SupabaseCopilotCatalogRepository,
  type CopilotReviewRequest,
} from "./copilot-review.js";

const PERMISSION_BY_INTENT: Record<CopilotActionPlan["target"], PermissionCode> = {
  estimate: "sales.create",
  invoice: "sales.create",
  customer_create: "customers.write",
  vendor_create: "vendors.write",
  rate_list_update: "products.write",
  customer_payment: "payments.create",
  vendor_payment: "payments.create",
  customer_return: "returns.create",
  supplier_bill: "purchases.create",
  inventory_adjustment: "inventory.adjust",
};

function client() {
  return getSupabaseAdminClient() as any;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function copilotFingerprint(plan: CopilotActionPlan): string {
  return createHash("sha256").update(JSON.stringify(stableValue(plan)), "utf8").digest("hex");
}

function positiveId(value: string | undefined, field: string): number {
  if (!value) throw new Error(`${field} is required`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function isoDate(value?: string): string {
  const date = value ?? new Date().toISOString().slice(0, 10);
  if (Number.isNaN(Date.parse(date))) throw new Error("documentDate must be a valid date");
  return date.slice(0, 10);
}

type RuntimeLine = {
  productId: number;
  quantity: number;
  unit?: string;
  rate?: number;
  rateListId?: number;
  rateListSelectionSource?: RateListSelectionSource;
  brandHint?: string;
  sourceItemId?: number;
};

function requireLineProducts(plan: CopilotActionPlan): RuntimeLine[] {
  return plan.lines.map((line) => {
    if (line.productId === undefined) throw new Error(`product resolution is required for ${line.productName}`);
    if (line.rateSource === "UNRESOLVED_BRAND_HINT") {
      throw new ApiError(422, "UNRESOLVED_BRAND_HINT", `Brand/company hint for ${line.productName} could not be resolved to an explicit rate list`);
    }
    const result: RuntimeLine = { productId: line.productId, quantity: line.quantity };
    if (line.unit !== undefined) result.unit = line.unit;
    if (line.explicitUnitRate !== undefined) result.rate = line.explicitUnitRate;
    const rateListId = line.pricingSelection?.mode === "RATE_LIST" ? line.pricingSelection.rate_list_id : undefined;
    if (rateListId != null) {
      result.rateListId = rateListId;
      result.rateListSelectionSource = line.pricingSelection?.source === "AI_SUGGESTED"
        ? "OCR_BRAND_MATCH"
        : line.pricingSelection?.source === "LINE_OVERRIDE"
          ? "LINE_OVERRIDE"
          : "ESTIMATE_DEFAULT";
    }
    if (line.sourceItemId !== undefined) result.sourceItemId = line.sourceItemId;
    if (line.brandHint !== undefined) result.brandHint = line.brandHint;
    return result;
  });
}

function sourceType(source: CopilotActionPlan["source"]): "VOICE" | "OCR" | "AI_ASSISTED" {
  if (source === "voice") return "VOICE";
  if (source === "image" || source === "camera") return "OCR";
  return "AI_ASSISTED";
}

export interface CopilotRuntimeDependencies {
  authorization: Pick<AuthorizationService, "assertPermission">;
  branchAccess?: Pick<TenantAccessService, "assertBranchAccess">;
  references?: Pick<CopilotReferenceResolver, "assertOwnedReferences">;
  review?: Pick<CopilotReviewService, "prepare">;
  erp: ErpService;
  pricing: PricingService;
  estimate: EstimateService;
  salesTransaction: Pick<SalesTransactionPort, "execute">;
  returns: Pick<SalesReturnService, "recordSalesReturn">;
  rateLists?: Pick<RateListService, "createDraftVersion">;
  customerPayments?: Pick<CustomerPaymentService, "recordPayment">;
  vendorPayments?: Pick<VendorPaymentService, "recordPayment">;
  database: () => any;
  servicePrincipalId?: string;
}

function defaultDependencies(erp: ErpService): CopilotRuntimeDependencies {
  const rateListRepository = new SupabaseRateListRepository();
  const pricing = new DefaultPricingService(rateListRepository);
  const aiProvider = new OpenAiProvider();
  const servicePrincipalId = normalizeServicePrincipalId(env.INTERNAL_API_PRINCIPAL_ID);
  if (!servicePrincipalId) throw new Error("Configured AI Copilot service principal is required");
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("Supabase configuration is required for AI Copilot execution");
  }
  const authorizationGateway = new SupabaseAuthorizationGateway(
    createAuthorizationClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY),
  );
  return {
    authorization: new AuthorizationService(authorizationGateway),
    branchAccess: new TenantAccessService(authorizationGateway),
    references: new SupabaseCopilotReferenceResolver(client),
    review: new CopilotReviewService(
      aiProvider,
      new SupabaseCopilotCatalogRepository(client),
      new ProviderIntentResolver(aiProvider),
    ),
    erp,
    pricing,
    estimate: new DefaultEstimateService(
      new SupabaseEstimateRepository(),
      new DefaultEstimatePricingService(pricing),
    ),
    salesTransaction: new SupabaseSalesTransactionAdapter(getSupabaseAdminClient, servicePrincipalId),
    returns: new SupabaseSalesReturnService(),
    rateLists: new DefaultRateListService(rateListRepository),
    customerPayments: new SupabaseCustomerPaymentService(),
    vendorPayments: new SupabaseVendorPaymentService(),
    database: client,
    servicePrincipalId,
  };
}

export class CopilotRuntime {
  private readonly dependencies: CopilotRuntimeDependencies;

  constructor(erp: ErpService = new SupabaseErpService(), dependencies?: CopilotRuntimeDependencies) {
    this.dependencies = dependencies ?? defaultDependencies(erp);
  }

  private async assertPlanAuthorized(plan: CopilotActionPlan): Promise<void> {
    if (!plan.branchId) throw new ApiError(403, "BRANCH_CONTEXT_REQUIRED", "Explicit branch context is required");
    if (!this.dependencies.branchAccess) {
      throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Copilot branch authorization is not configured");
    }
    await this.dependencies.authorization.assertPermission(
      plan.userId,
      plan.organizationId,
      PERMISSION_BY_INTENT[plan.target],
    );
    await this.dependencies.branchAccess.assertBranchAccess(
      { userId: plan.userId, organizationId: plan.organizationId },
      plan.branchId,
    );
  }

  private async assertPlanReferences(plan: CopilotActionPlan): Promise<void> {
    if (!this.dependencies.references) {
      throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Copilot reference resolution is not configured");
    }
    await this.dependencies.references.assertOwnedReferences(plan);
  }

  async prepareReview(request: CopilotReviewRequest, branchId: string) {
    if (request.intent === "invoice") {
      throw new ApiError(422, "COPILOT_INVOICE_NOT_SUPPORTED", "Create an Estimate, review it in the native Estimate screen, then use the native Convert to Invoice workflow");
    }
    if (!branchId.trim()) throw new ApiError(403, "BRANCH_CONTEXT_REQUIRED", "Explicit branch context is required");
    if (!this.dependencies.branchAccess || !this.dependencies.review) {
      throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Copilot review preparation is not configured");
    }
    await this.dependencies.branchAccess.assertBranchAccess(
      { userId: request.userId, organizationId: request.organizationId },
      branchId,
    );
    if (request.intent) {
      await this.dependencies.authorization.assertPermission(
        request.userId,
        request.organizationId,
        PERMISSION_BY_INTENT[request.intent],
      );
    }
    const review = await this.dependencies.review.prepare(request);
    if (!request.intent) {
      await this.dependencies.authorization.assertPermission(
        request.userId,
        request.organizationId,
        PERMISSION_BY_INTENT[review.intent],
      );
    }
    return review;
  }

  async prepareInvoiceExtraction(request: Omit<CopilotReviewRequest, "intent">, branchId: string) {
    if (!branchId.trim()) throw new ApiError(403, "BRANCH_CONTEXT_REQUIRED", "Explicit branch context is required");
    if (!this.dependencies.branchAccess || !this.dependencies.review) {
      throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Copilot document extraction is not configured");
    }
    await this.dependencies.authorization.assertPermission(request.userId, request.organizationId, "sales.read");
    await this.dependencies.branchAccess.assertBranchAccess(
      { userId: request.userId, organizationId: request.organizationId },
      branchId,
    );
    const review = await this.dependencies.review.prepare({ ...request, intent: "invoice" });
    return { ...review, extractionOnly: true as const, executable: false as const };
  }

  async createDraft(
    draft: AiDraft,
    context: {
      userId: string;
      branchId?: string;
      warehouseId?: number;
      rateListId?: number;
      documentNumber?: string;
      documentDate?: string;
      currencyCode?: string;
      reason?: string;
    },
    idempotencyKey: string,
  ) {
    if (draft.intent === "invoice") {
      throw new ApiError(422, "COPILOT_INVOICE_NOT_SUPPORTED", "Copilot cannot create Invoices; create an Estimate and use the native conversion workflow");
    }
    const plan = createCopilotPlanFromDraft(draft, context).plan;
    return this.persistPlan(plan, idempotencyKey);
  }

  async createMasterDataDraft(
    input: {
      organizationId: string;
      userId: string;
      branchId: string;
      source: CopilotActionPlan["source"];
      intent: "customer_create" | "vendor_create";
      name: string;
      phone: string;
      city: string;
    },
    idempotencyKey: string,
  ) {
    const details = { name: input.name.trim(), phone: input.phone.trim(), city: input.city.trim() };
    const plan: CopilotActionPlan = {
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      source: input.source,
      target: input.intent,
      ...(input.intent === "customer_create" ? { customerData: details } : { vendorData: details }),
      lines: [],
      requiresConfirmation: true,
    };
    return this.persistPlan(plan, idempotencyKey);
  }

  async createRateListDraft(
    input: {
      organizationId: string;
      userId: string;
      branchId: string;
      source: CopilotActionPlan["source"];
      rateListId: number;
      versionNumber: number;
      effectiveFrom: string;
      lines: Array<{ productName: string; productId: number; minimumQuantity: number; unit: string; unitRate: number }>;
    },
    idempotencyKey: string,
  ) {
    const plan: CopilotActionPlan = {
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      source: input.source,
      target: "rate_list_update",
      rateListUpdate: {
        rateListId: input.rateListId,
        versionNumber: input.versionNumber,
        effectiveFrom: input.effectiveFrom,
      },
      lines: input.lines.map((line) => ({
        productName: line.productName.trim(),
        productId: line.productId,
        quantity: line.minimumQuantity,
        unit: line.unit.trim(),
        explicitUnitRate: line.unitRate,
        rateSource: "EXPLICIT_USER_RATE",
      })),
      requiresConfirmation: true,
    };
    return this.persistPlan(plan, idempotencyKey);
  }

  async createFinancialDraft(
    input: {
      organizationId: string;
      userId: string;
      branchId: string;
      source: CopilotActionPlan["source"];
      intent: "customer_payment" | "vendor_payment";
      payment: CustomerPaymentInput | VendorPaymentInput;
    },
    idempotencyKey: string,
  ) {
    const plan: CopilotActionPlan = {
      organizationId: input.organizationId,
      branchId: input.branchId,
      userId: input.userId,
      source: input.source,
      target: input.intent,
      ...(input.intent === "customer_payment"
        ? { customerId: String((input.payment as CustomerPaymentInput).customer_id), customerPaymentData: input.payment as CustomerPaymentInput }
        : { vendorId: String((input.payment as VendorPaymentInput).vendor_id), vendorPaymentData: input.payment as VendorPaymentInput }),
      lines: [],
      requiresConfirmation: true,
    };
    return this.persistPlan(plan, idempotencyKey);
  }

  private async persistPlan(plan: CopilotActionPlan, idempotencyKey: string) {
    await this.assertPlanAuthorized(plan);
    await this.assertPlanReferences(plan);
    const fingerprint = copilotFingerprint(plan);
    const db = this.dependencies.database();
    const { data: existing, error: existingError } = await db
      .from("ai_copilot_actions")
      .select("*")
      .eq("organization_id", plan.organizationId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      if (existing.user_id !== plan.userId) throw new Error("Idempotency-Key belongs to a different Copilot user");
      if (existing.request_fingerprint !== fingerprint) throw new Error("Idempotency-Key was reused for a different Copilot action");
      return existing;
    }
    const { data, error } = await db
      .from("ai_copilot_actions")
      .insert({
        organization_id: plan.organizationId,
        user_id: plan.userId,
        intent: plan.target,
        status: "DRAFT",
        idempotency_key: idempotencyKey,
        request_fingerprint: fingerprint,
        action_plan: plan,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  async confirmAndExecute(actionId: string, organizationId: string, userId: string, idempotencyKey: string, branchId?: string) {
    const db = this.dependencies.database();
    const { data: action, error } = await db.from("ai_copilot_actions").select("*").eq("id", actionId).maybeSingle();
    if (error) throw error;
    if (!action) throw new Error("Copilot draft was not found");
    if (action.organization_id !== organizationId) throw new Error("copilot action organization mismatch");
    if (action.user_id !== userId) throw new Error("copilot action user mismatch");
    if (action.idempotency_key !== idempotencyKey) throw new Error("copilot confirmation idempotency mismatch");
    const plan = action.action_plan as CopilotActionPlan;
    if (plan.target === "invoice") {
      throw new ApiError(422, "COPILOT_INVOICE_NOT_SUPPORTED", "Copilot cannot execute Invoice drafts; use the native Estimate-to-Invoice workflow");
    }
    assertCopilotDraftExecution(plan, organizationId, userId, plan.target, branchId);
    await this.assertPlanAuthorized(plan);
    await this.assertPlanReferences(plan);
    if (action.status === "EXECUTED") return action;
    if (action.status === "CONFIRMED") throw new Error("Copilot action is already being executed");
    if (action.status !== "DRAFT") throw new Error(`Copilot action cannot be confirmed from ${action.status}`);
    const { data: claimed, error: claimError } = await db
      .from("ai_copilot_actions")
      .update({ status: "CONFIRMED", confirmed_at: new Date().toISOString() })
      .eq("id", actionId)
      .eq("status", "DRAFT")
      .select("*")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) throw new Error("Copilot action was already claimed by another request");
    try {
      const result = await this.execute(plan, idempotencyKey);
      const { data: completed, error: completeError } = await db
        .from("ai_copilot_actions")
        .update({ status: "EXECUTED", result, executed_at: new Date().toISOString() })
        .eq("id", actionId)
        .eq("status", "CONFIRMED")
        .select("*")
        .single();
      if (completeError) throw completeError;
      return completed;
    } catch (error) {
      await db
        .from("ai_copilot_actions")
        .update({ status: "FAILED", error_code: error instanceof Error ? error.message : "COPILOT_EXECUTION_FAILED" })
        .eq("id", actionId)
        .eq("status", "CONFIRMED");
      throw error;
    }
  }

  private async execute(plan: CopilotActionPlan, idempotencyKey: string): Promise<unknown> {
    const date = isoDate(plan.documentDate);
    const currency = plan.currencyCode ?? "PKR";
    const estimatePricing = new DefaultEstimatePricingService(this.dependencies.pricing);
    const servicePrincipalId = normalizeServicePrincipalId(this.dependencies.servicePrincipalId);

    if (plan.target === "customer_create") {
      if (!plan.customerData) throw new Error("customer details are required");
      return this.dependencies.erp.createCustomer(plan.customerData, plan.organizationId);
    }

    if (plan.target === "vendor_create") {
      if (!plan.vendorData) throw new Error("vendor details are required");
      return this.dependencies.erp.createVendor(plan.vendorData, plan.organizationId);
    }

    if (plan.target === "customer_payment") {
      if (!plan.customerPaymentData) throw new Error("customer payment details are required");
      if (!servicePrincipalId) throw new Error("Configured AI Copilot service principal is required");
      if (!this.dependencies.customerPayments) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Customer payment service is not configured");
      return this.dependencies.customerPayments.recordPayment(plan.customerPaymentData, {
        organizationId: plan.organizationId,
        branchId: plan.branchId!,
        actorUserId: plan.userId,
        servicePrincipalId,
        operation: "customer-payment.create",
        idempotencyKey,
        requestFingerprint: copilotFingerprint(plan),
      });
    }

    if (plan.target === "vendor_payment") {
      if (!plan.vendorPaymentData) throw new Error("vendor payment details are required");
      if (!servicePrincipalId) throw new Error("Configured AI Copilot service principal is required");
      if (!this.dependencies.vendorPayments) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Vendor payment service is not configured");
      return this.dependencies.vendorPayments.recordPayment(plan.vendorPaymentData, {
        organizationId: plan.organizationId,
        branchId: plan.branchId!,
        actorUserId: plan.userId,
        servicePrincipalId,
        operation: "vendor-payment.create",
        idempotencyKey,
        requestFingerprint: copilotFingerprint(plan),
      });
    }

    const lines = requireLineProducts(plan);

    if (plan.target === "rate_list_update") {
      if (!plan.rateListUpdate) throw new Error("rate-list update details are required");
      if (!this.dependencies.rateLists) throw new ApiError(503, "COPILOT_NOT_CONFIGURED", "Rate List authoring service is not configured");
      return this.dependencies.rateLists.createDraftVersion({
        organization_id: plan.organizationId,
        rate_list_id: plan.rateListUpdate.rateListId,
        version_number: plan.rateListUpdate.versionNumber,
        effective_from: plan.rateListUpdate.effectiveFrom,
        items: lines.map((line) => {
          if (line.rate === undefined) throw new Error(`explicit rate is required for ${line.productId}`);
          if (!line.unit?.trim()) throw new Error(`unit is required for ${line.productId}`);
          return {
            product_id: line.productId,
            minimum_quantity: line.quantity,
            unit_price: line.rate,
            unit: line.unit,
          };
        }),
      });
    }

    if (plan.target === "estimate") {
      const customerId = positiveId(plan.customerId, "customerId");
      const pricedLines = await Promise.all(lines.map((line, index) => estimatePricing.priceLine({
        line_number: index + 1,
        product_id: line.productId,
        quantity: line.quantity,
        unit: line.unit ?? "unit",
        ...(line.rate !== undefined ? { unit_price: line.rate } : {}),
        ...(line.brandHint !== undefined ? { brand_hint: line.brandHint } : {}),
        ...(line.rateListId !== undefined ? { rate_list_id: line.rateListId, ...(line.rateListSelectionSource ? { rate_list_selection_source: line.rateListSelectionSource } : {}) } : {}),
      }, { organization_id: plan.organizationId, price_type: "SALE", as_of: date, customer_id: customerId })));
      return this.dependencies.estimate.createDraft({
        definition: {
          organization_id: plan.organizationId,
          customer_id: customerId,
          estimate_number: plan.documentNumber ?? `AI-${Date.now()}`,
          issue_date: date,
          currency_code: currency,
          notes: plan.reason ?? null,
          ...(plan.branchId !== undefined ? { branch_id: plan.branchId } : {}),
        },
        lines: pricedLines,
      }, {
        source_type: sourceType(plan.source),
        source_reference: `ai-copilot:${idempotencyKey}`,
        ...(plan.branchId !== undefined ? { branch_id: plan.branchId } : {}),
        actor_user_id: plan.userId,
        idempotency_key: idempotencyKey,
      });
    }

    if (plan.target === "invoice") {
      const customerId = positiveId(plan.customerId, "customerId");
      if (!plan.warehouseId) throw new Error("warehouseId is required for invoice");
      const pricedLines = await Promise.all(lines.map((line, index) => estimatePricing.priceLine({
        line_number: index + 1,
        product_id: line.productId,
        quantity: line.quantity,
        unit: line.unit ?? "unit",
        ...(line.rate !== undefined ? { unit_price: line.rate } : {}),
        ...(line.brandHint !== undefined ? { brand_hint: line.brandHint } : {}),
        ...(line.rateListId !== undefined ? { rate_list_id: line.rateListId, ...(line.rateListSelectionSource ? { rate_list_selection_source: line.rateListSelectionSource } : {}) } : {}),
      }, { organization_id: plan.organizationId, price_type: "SALE", as_of: date, customer_id: customerId })));
      const subtotal = pricedLines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0);
      const invoice: InvoiceDocument = buildDirectInvoice({
        invoice_number: plan.documentNumber ?? `AI-${Date.now()}`,
        customer_id: customerId,
        issue_date: date,
        currency_code: currency,
        notes: plan.reason ?? null,
      }, pricedLines, subtotal, 0, subtotal, 0);
      const transactionLines: SalesTransactionLine[] = pricedLines.map((line, index) => ({
        line_number: index + 1,
        product_id: line.product_id,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        line_total: line.quantity * line.unit_price,
        unit_cost: null,
        cogs_total: null,
      }));
      if (!plan.branchId) throw new Error("branchId is required for invoice");
      return this.dependencies.salesTransaction.execute({
        organization_id: plan.organizationId,
        branch_id: plan.branchId,
        actor_user_id: plan.userId,
        invoice,
        warehouse_id: plan.warehouseId,
        lines: transactionLines,
        idempotency_key: idempotencyKey,
      });
    }

    if (plan.target === "supplier_bill") {
      if (!servicePrincipalId) throw new Error("Configured AI Copilot service principal is required");
      const vendorId = positiveId(plan.vendorId, "vendorId");
      if (!plan.warehouseId) throw new Error("warehouseId is required for supplier bill");
      if (!plan.branchId) throw new Error("branchId is required for supplier bill");
      const purchaseLines = await Promise.all(lines.map(async (line) => {
        let unitCost = line.rate;
        if (unitCost === undefined) {
          const resolved = await this.dependencies.pricing.resolvePrice({
            organization_id: plan.organizationId,
            product_id: line.productId,
            quantity: line.quantity,
            price_type: "PURCHASE",
            as_of: date,
            vendor_id: vendorId,
            rate_list_id: line.rateListId ?? null,
          });
          if (!resolved) throw new Error(`no applicable purchase price found for product_id ${line.productId}`);
          unitCost = resolved.unit_price;
        }
        return { product_id: line.productId, quantity: line.quantity, unit_cost: unitCost };
      }));
      const purchaseInput = {
        vendor_id: vendorId,
        warehouse_id: plan.warehouseId,
        items: purchaseLines,
        purchase_date: date,
        ...(plan.documentNumber !== undefined ? { invoice_number: plan.documentNumber } : {}),
        ...(plan.reason !== undefined ? { notes: plan.reason } : {}),
      };
      return this.dependencies.erp.recordPurchase(purchaseInput, {
        organizationId: plan.organizationId,
        branchId: plan.branchId,
        actorUserId: plan.userId,
        servicePrincipalId,
        operation: "purchase.create",
        idempotencyKey,
        requestFingerprint: copilotFingerprint(plan),
      });
    }

    if (plan.target === "customer_return") {
      if (!servicePrincipalId) throw new Error("Configured AI Copilot service principal is required");
      const customerId = positiveId(plan.customerId, "customerId");
      if (!plan.documentNumber) throw new Error("documentNumber must contain the source invoice id for customer return");
      const invoiceId = positiveId(plan.documentNumber, "invoiceId");
      if (!plan.warehouseId) throw new Error("warehouseId is required for customer return");
      if (!plan.branchId) throw new Error("branchId is required for customer return");
      if (!plan.reason?.trim()) throw new Error("reason is required for customer return");
      if (lines.some((line) => line.sourceItemId === undefined)) throw new Error("sourceItemId is required for every customer return line");
      return this.dependencies.returns.recordSalesReturn({
        credit_note_number: `CN-${Date.now()}`,
        invoice_id: invoiceId,
        customer_id: customerId,
        credit_date: date,
        currency_code: currency,
        reason: plan.reason,
        items: lines.map((line) => ({ invoice_item_id: line.sourceItemId!, warehouse_id: plan.warehouseId!, quantity: line.quantity })),
      }, {
        organizationId: plan.organizationId,
        branchId: plan.branchId,
        actorUserId: plan.userId,
        servicePrincipalId,
        operation: "sales-return.create",
        idempotencyKey,
        requestFingerprint: copilotFingerprint(plan),
      });
    }

    if (plan.target === "inventory_adjustment") {
      if (!plan.warehouseId) throw new Error("warehouseId is required for inventory adjustment");
      if (!plan.reason?.trim()) throw new Error("reason is required for inventory adjustment");
      if (lines.length !== 1) throw new Error("inventory adjustment requires exactly one line");
      throw new ApiError(
        409,
        "AUTHORITATIVE_INVENTORY_ADJUSTMENT_UNAVAILABLE",
        "Inventory adjustment requires a costed, accounting-safe authoritative transaction engine",
      );
    }

    throw new Error(`Unsupported Copilot intent: ${plan.target}`);
  }
}
