import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { SupabaseRateListRepository, type RateListRecord, type RateListRepository } from "../repositories/rate-list.repository.js";
import { DefaultEstimatePricingService } from "../services/estimate-pricing.service.js";
import { DefaultEstimateService, type EstimateService } from "../services/estimate.service.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { DefaultPricingService, type PricingService } from "../services/pricing.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const idSchema = z.coerce.number().int().positive();
const lineSchema = z.strictObject({
  product_id: idSchema,
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50),
  unit_price: z.number().finite().nonnegative(),
});
const draftSchema = z.strictObject({
  customer_id: idSchema,
  estimate_number: z.string().trim().min(1).max(100),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency_code: z.string().trim().min(3).max(10).default("PKR"),
  notes: z.string().trim().max(2_000).nullable().optional(),
  overall_discount: z.number().finite().nonnegative().default(0),
  carriage_delivery: z.number().finite().nonnegative().default(0),
  default_rate_list_id: idSchema.nullable().optional(),
  lines: z.array(lineSchema).min(1).max(500),
}).refine((draft) => draft.overall_discount <= draft.lines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0), {
  message: "Overall discount cannot exceed the estimate subtotal",
  path: ["overall_discount"],
});

const rateListQuerySchema = z.object({
  customer_id: idSchema.optional(),
  currency_code: z.string().trim().min(3).max(10).default("PKR"),
});

const ratePreviewSchema = z.strictObject({
  customer_id: idSchema.nullable().optional(),
  target_rate_list_id: idSchema,
  pricing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency_code: z.string().trim().min(3).max(10).default("PKR"),
  lines: z.array(z.strictObject({
    product_id: idSchema,
    quantity: z.number().finite().positive(),
    unit: z.string().trim().min(1).max(50),
    current_unit_price: z.number().finite().nonnegative(),
  })).min(1).max(500),
});

type ReferenceService = Pick<ErpService, "getCustomer" | "getProduct">;
type TenantAuthorizer = Pick<TenantAccessService, "assertAuthorized">;

export interface EstimateDraftRouterOptions {
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
  service?: EstimateService | undefined;
  referenceService?: ReferenceService | undefined;
  tenantAuthorizer?: TenantAuthorizer | undefined;
  rateListRepository?: Pick<RateListRepository, "listActiveSaleRateLists"> | undefined;
  pricingService?: Pick<PricingService, "resolvePrice"> | undefined;
  authenticate?: RequestHandler | undefined;
}

interface EstimateIdentity {
  userId: string;
  organizationId: string;
  branchId: string;
}

function sameOrigin(request: Request): void {
  const origin = request.header("Origin");
  if (request.header("Sec-Fetch-Site") === "cross-site" || (origin && new URL(origin).host !== request.get("host"))) {
    throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  }
}

function identityFor(request: Request): EstimateIdentity {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { userId: identity.actorUserId, organizationId: identity.organizationId, branchId: identity.branchId };
  }
  sameOrigin(request);
  const actor = request.header("X-Actor-User-Id")?.trim();
  if (actor && actor !== request.browserPrincipal.userId) {
    throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  }
  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
  };
}

function defaultEstimateService(): EstimateService {
  const rateLists = new SupabaseRateListRepository();
  return new DefaultEstimateService(
    new SupabaseEstimateRepository(),
    new DefaultEstimatePricingService(new DefaultPricingService(rateLists)),
  );
}

function isAvailableRateList(list: RateListRecord, customerId: number | null, currencyCode: string): boolean {
  if (!list.is_active || list.price_type !== "SALE" || list.currency_code.toUpperCase() !== currencyCode.toUpperCase()) return false;
  if (list.scope_type === "GLOBAL") return true;
  return list.scope_type === "CUSTOMER" && customerId != null && list.customer_id === customerId;
}

function allocateOverallDiscount(lines: Array<{ quantity: number; unit_price: number }>, discount: number): number[] {
  let remaining = discount;
  return lines.map((line) => {
    if (remaining <= 0) return 0;
    const lineAmount = line.quantity * line.unit_price;
    const allocated = Math.min(lineAmount, remaining);
    remaining -= allocated;
    return allocated;
  });
}

export function createEstimateDraftRouter(options: EstimateDraftRouterOptions = {}): Router {
  const router = Router();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;
  let service = options.service;
  let references = options.referenceService;
  let rateLists = options.rateListRepository;
  let pricing = options.pricingService;

  function getRateLists(): Pick<RateListRepository, "listActiveSaleRateLists"> {
    rateLists ??= new SupabaseRateListRepository();
    return rateLists;
  }

  function getPricing(): Pick<PricingService, "resolvePrice"> {
    pricing ??= new DefaultPricingService(getRateLists() as RateListRepository);
    return pricing;
  }

  async function authorize(request: Request, permission: PermissionCode): Promise<EstimateIdentity> {
    const identity = identityFor(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/rate-lists", authenticate, async (request, response) => {
    const identity = await authorize(request, "sales.create");
    const query = rateListQuerySchema.parse(request.query);
    const customerId = query.customer_id ?? null;
    const lists = (await getRateLists().listActiveSaleRateLists(identity.organizationId))
      .filter((list) => isAvailableRateList(list, customerId, query.currency_code));
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({
      data: lists.map((list) => ({ id: list.id, name: list.name, code: list.code, scope: list.scope_type })),
    });
  });

  router.post("/rate-list-preview", authenticate, async (request, response) => {
    const identity = await authorize(request, "sales.create");
    const input = ratePreviewSchema.parse(request.body);
    const customerId = input.customer_id ?? null;
    const available = await getRateLists().listActiveSaleRateLists(identity.organizationId);
    const target = available.find((list) => list.id === input.target_rate_list_id && isAvailableRateList(list, customerId, input.currency_code));
    if (!target) throw new ApiError(404, "RATE_LIST_NOT_FOUND", "The selected rate list is not available for this estimate");

    references ??= new SupabaseErpService();
    const productIds = [...new Set(input.lines.map((line) => line.product_id))];
    const products = await Promise.all(productIds.map((productId) => references!.getProduct(productId, identity.organizationId)));
    if (products.some((product) => product === null)) throw new ApiError(404, "PRODUCT_NOT_FOUND", "One or more products are not available in this organization");

    const lines = await Promise.all(input.lines.map(async (line, index) => {
      try {
        const resolved = await getPricing().resolvePrice({
          organization_id: identity.organizationId,
          price_type: "SALE",
          product_id: line.product_id,
          quantity: line.quantity,
          as_of: input.pricing_date,
          customer_id: customerId,
          rate_list_id: target.id,
        });
        if (!resolved) return { line_number: index + 1, product_id: line.product_id, old_rate: line.current_unit_price, new_rate: null, status: "UNMATCHED", message: "No authorized rate was found for this item." };
        if (resolved.product_id !== line.product_id || resolved.rate_list_id !== target.id || resolved.currency_code.toUpperCase() !== input.currency_code.toUpperCase() || resolved.unit !== line.unit || !Number.isFinite(resolved.unit_price) || resolved.unit_price < 0) {
          return { line_number: index + 1, product_id: line.product_id, old_rate: line.current_unit_price, new_rate: null, status: "NEEDS_REVIEW", message: "The available match has an incompatible product, unit, or currency." };
        }
        return { line_number: index + 1, product_id: line.product_id, old_rate: line.current_unit_price, new_rate: resolved.unit_price, status: "MATCHED", message: null };
      } catch (error) {
        if (!/ambiguous/i.test(error instanceof Error ? error.message : "")) throw error;
        return { line_number: index + 1, product_id: line.product_id, old_rate: line.current_unit_price, new_rate: null, status: "NEEDS_REVIEW", message: "More than one possible authorized match was found." };
      }
    }));
    const matched = lines.filter((line) => line.status === "MATCHED").length;
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: { rate_list: { id: target.id, name: target.name, code: target.code }, lines, matched, needs_review: lines.length - matched, can_apply: matched === lines.length } });
  });

  router.post("/", authenticate, async (request, response) => {
    const identity = await authorize(request, "sales.create");
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    }
    const input = draftSchema.parse(request.body);
    references ??= new SupabaseErpService();
    const [customer, ...products] = await Promise.all([
      references.getCustomer(input.customer_id, identity.organizationId),
      ...[...new Set(input.lines.map((line) => line.product_id))].map((productId) =>
        references!.getProduct(productId, identity.organizationId)),
    ]);
    if (!customer) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Customer was not found in this organization");
    if (products.some((product) => product === null)) {
      throw new ApiError(404, "PRODUCT_NOT_FOUND", "One or more products were not found in this organization");
    }

    if (input.default_rate_list_id != null) {
      const available = await getRateLists().listActiveSaleRateLists(identity.organizationId);
      if (!available.some((list) => list.id === input.default_rate_list_id && isAvailableRateList(list, input.customer_id, input.currency_code))) {
        throw new ApiError(404, "RATE_LIST_NOT_FOUND", "The selected rate list is not available for this estimate");
      }
    }

    service ??= defaultEstimateService();
    const lineDiscounts = allocateOverallDiscount(input.lines, input.overall_discount);
    const created = await service.createDraft({
      definition: {
        organization_id: identity.organizationId,
        branch_id: identity.branchId,
        customer_id: input.customer_id,
        estimate_number: input.estimate_number,
        issue_date: input.issue_date,
        currency_code: input.currency_code.toUpperCase(),
        notes: input.notes ?? null,
        pass_through_rent: input.carriage_delivery,
        pass_through_rent_payee: input.carriage_delivery > 0 ? "Carriage / Delivery" : null,
        default_rate_list_id: input.default_rate_list_id ?? null,
        layout_key: "MODERN_PAKISTAN",
      },
      lines: input.lines.map((line, index) => ({
        line_number: index + 1,
        product_id: line.product_id,
        quantity: line.quantity,
        unit: line.unit,
        unit_price: line.unit_price,
        discount_amount: lineDiscounts[index] ?? 0,
        pricing_source: "MANUAL_OVERRIDE",
        rate_list_id: input.default_rate_list_id ?? null,
        rate_list_selection_source: input.default_rate_list_id == null ? "MANUAL_OVERRIDE" : "ESTIMATE_DEFAULT",
      })),
    }, {
      source_type: "MANUAL",
      source_reference: "browser-estimate",
      branch_id: identity.branchId,
      actor_user_id: identity.userId,
      idempotency_key: idempotencyKey,
    });
    response.status(201).json({ data: created });
  });

  return router;
}
