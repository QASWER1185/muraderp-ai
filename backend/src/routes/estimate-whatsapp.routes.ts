import { Router, type Request } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
import { SupabaseEstimateRepository } from "../repositories/estimate.repository.js";
import { SupabaseErpService } from "../services/erp.service.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { DefaultEstimateWhatsAppShareService, type EstimateWhatsAppShareService } from "../services/estimate-whatsapp-share.service.js";

const idSchema = z.coerce.number().int().positive();

function identityFor(request: Request) {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { organizationId: identity.organizationId, branchId: identity.branchId, userId: identity.actorUserId };
  }
  const origin = request.header("Origin");
  if (request.header("Sec-Fetch-Site") === "cross-site" || (origin && new URL(origin).host !== request.get("host"))) throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  const actor = request.header("X-Actor-User-Id");
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  return {
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
    userId: request.browserPrincipal.userId,
  };
}

function defaultService(): EstimateWhatsAppShareService {
  return new DefaultEstimateWhatsAppShareService(
    new SupabaseEstimateRepository(),
    new SupabaseErpService(),
    new TenantAccessService(createServiceRoleAuthorizationGateway()),
  );
}

export function createEstimateWhatsAppRouter(
  internalApiToken?: string,
  servicePrincipalId?: string,
  service?: EstimateWhatsAppShareService,
) {
  const router = Router();
  const authorize = createCopilotAuth(internalApiToken, servicePrincipalId);
  let activeService = service;
  const getService = () => { activeService ??= defaultService(); return activeService; };

  router.get("/:id/whatsapp-share", authorize, async (request, response) => {
    const identity = identityFor(request);
    const delivery = await getService().prepare({
      estimateId: idSchema.parse(request.params.id),
      organizationId: identity.organizationId,
      branchId: identity.branchId,
      userId: identity.userId,
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: delivery });
  });
  return router;
}
