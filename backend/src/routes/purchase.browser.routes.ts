import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { authoritativeRequestFingerprint, requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
import { normalizedPurchaseForFingerprint, purchaseSchema } from "./erp.routes.js";

const id = z.coerce.number().int().positive();
const page = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const operation = "purchase.create" as const;
type PurchaseService = Pick<ErpService, "listPurchases" | "getPurchase" | "recordPurchase">;

export interface PurchaseBrowserOptions {
  service?: PurchaseService | undefined;
  tenantAuthorizer?: Pick<TenantAccessService, "assertAuthorized"> | undefined;
  authenticate?: RequestHandler | undefined;
  internalApiToken?: string | undefined;
  servicePrincipalId?: string | undefined;
}

function identityFor(request: Request) {
  if (!request.browserPrincipal) {
    const identity = requireAuthoritativeTransactionIdentity(request);
    return { userId: identity.actorUserId, organizationId: identity.organizationId, branchId: identity.branchId };
  }
  const origin = request.header("Origin");
  const fetchSite = request.header("Sec-Fetch-Site");
  const originHost = origin && URL.canParse(origin) ? new URL(origin).host : null;
  const forwardedHost = request.header("X-Forwarded-Host")?.trim();
  const sameHost = originHost === request.get("host");
  const sameProxiedHost = fetchSite === "same-origin" && originHost === forwardedHost;
  if (fetchSite === "cross-site" || (origin && (!originHost || (!sameHost && !sameProxiedHost)))) {
    throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  }
  const actor = request.header("X-Actor-User-Id")?.trim();
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
  };
}

export function createPurchaseBrowserRouter(options: PurchaseBrowserOptions = {}): Router {
  const router = Router();
  const service = options.service ?? new SupabaseErpService();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let authorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode) {
    const identity = identityFor(request);
    authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId }, permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "purchases.read");
    response.setHeader("Cache-Control", "no-store");
    response.json(await service.listPurchases(page.parse(request.query), identity.organizationId, identity.branchId));
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "purchases.read");
    const purchase = await service.getPurchase(id.parse(request.params.id), identity.organizationId, identity.branchId);
    if (!purchase) throw new ApiError(404, "NOT_FOUND", "Purchase was not found");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: purchase });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "purchases.create");
    const key = request.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
    const input = normalizedPurchaseForFingerprint(purchaseSchema.parse(request.body));
    const principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    if (!principal) throw new ApiError(503, "ERP_NOT_CONFIGURED", "Purchase service principal is not configured");
    const result = await service.recordPurchase(input, {
      organizationId: identity.organizationId, branchId: identity.branchId, actorUserId: identity.userId,
      servicePrincipalId: principal, operation, idempotencyKey: key,
      requestFingerprint: authoritativeRequestFingerprint(
        { organizationId: identity.organizationId, branchId: identity.branchId, actorUserId: identity.userId, servicePrincipalId: principal },
        operation, input,
      ),
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: result });
  });
  return router;
}
