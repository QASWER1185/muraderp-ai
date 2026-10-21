import { Router, type Request } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
import { DefaultEstimateCloneRepriceService, ESTIMATE_CONVERSION_MODES, type EstimateCloneRepriceService } from "../services/estimate-clone-reprice.service.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { SupabaseRateListRepository } from "../repositories/rate-list.repository.js";
import { DefaultPricingService } from "../services/pricing.service.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";

const idSchema = z.coerce.number().int().positive();
const modeSchema = z.enum(ESTIMATE_CONVERSION_MODES);
const previewSchema = z.strictObject({ mode: modeSchema, target_rate_list_id: idSchema.nullable().optional(), pricing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const confirmSchema = previewSchema.extend({ target_estimate_number: z.string().trim().min(1).max(100), preview_fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });

function defaultService(): EstimateCloneRepriceService {
  const repository = new SupabaseEstimateRepository();
  const rateLists = new SupabaseRateListRepository();
  return new DefaultEstimateCloneRepriceService(repository, new DefaultPricingService(rateLists, rateLists), new TenantAccessService(createServiceRoleAuthorizationGateway()), rateLists);
}

function identityFor(request: Request) {
  if (!request.browserPrincipal) return requireAuthoritativeTransactionIdentity(request);
  const origin = request.header("Origin");
  if (request.header("Sec-Fetch-Site") === "cross-site" || (origin && new URL(origin).host !== request.get("host"))) throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  const actor = request.header("X-Actor-User-Id");
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  return { organizationId: z.string().uuid().parse(request.header("X-Organization-Id")), branchId: z.string().uuid().parse(request.header("X-Branch-Id")), actorUserId: request.browserPrincipal.userId };
}

export function createEstimateConversionRouter(internalApiToken?: string, servicePrincipalId?: string, service?: EstimateCloneRepriceService) {
  const router = Router();
  const authorize = createCopilotAuth(internalApiToken, servicePrincipalId);
  let activeService = service;
  const getService = () => { activeService ??= defaultService(); return activeService; };

  router.post("/:id/reprice/preview", authorize, async (request, response) => {
    const identity = identityFor(request);
    const input = previewSchema.parse(request.body);
    const preview = await getService().preview({
      source_estimate_id: idSchema.parse(request.params.id), organization_id: identity.organizationId,
      mode: input.mode, target_rate_list_id: input.target_rate_list_id ?? null,
      branch_id: identity.branchId, actor_user_id: identity.actorUserId,
      pricing_date: input.pricing_date,
    });
    response.status(200).json({ data: preview });
  });

  router.post("/:id/reprice/confirm", authorize, async (request, response) => {
    const identity = identityFor(request);
    const input = confirmSchema.parse(request.body);
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const created = await getService().execute({
      source_estimate_id: idSchema.parse(request.params.id), organization_id: identity.organizationId,
      mode: input.mode, target_rate_list_id: input.target_rate_list_id ?? null,
      target_estimate_number: input.target_estimate_number, branch_id: identity.branchId,
      actor_user_id: identity.actorUserId, idempotency_key: idempotencyKey,
      pricing_date: input.pricing_date, preview_fingerprint: input.preview_fingerprint,
    });
    response.status(201).json({ data: created });
  });
  return router;
}
