import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseSalesReturnBrowserRepository, type SalesReturnBrowserRepository } from "../repositories/sales-return-browser.repository.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SupabaseSalesReturnService, type SalesReturnService } from "../services/sales-return.service.js";
import { authoritativeRequestFingerprint, requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
import { normalizedSalesReturnForFingerprint, salesReturnRequestSchema } from "./sales-return.routes.js";

const id = z.coerce.number().int().positive();
const page = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), search: z.string().trim().max(120).optional() });
const operation = "sales-return.create" as const;

export interface SalesReturnBrowserOptions {
  repository?: SalesReturnBrowserRepository | undefined;
  service?: SalesReturnService | undefined;
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

export function createSalesReturnBrowserRouter(options: SalesReturnBrowserOptions = {}): Router {
  const router = Router();
  const repository = options.repository ?? new SupabaseSalesReturnBrowserRepository();
  const service = options.service ?? new SupabaseSalesReturnService();
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
    const identity = await authorize(request, "sales.read");
    const query = page.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json(await repository.list(identity.organizationId, identity.branchId, query.limit, query.cursor, query.search));
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "sales.read");
    const found = await repository.getById(identity.organizationId, identity.branchId, id.parse(request.params.id));
    if (!found) throw new ApiError(404, "NOT_FOUND", "Return was not found");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: found });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "returns.create");
    const key = request.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
    const input = salesReturnRequestSchema.parse(request.body);
    const principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    if (!principal) throw new ApiError(503, "ERP_NOT_CONFIGURED", "Return service principal is not configured");
    const result = await service.recordSalesReturn(input, {
      organizationId: identity.organizationId,
      branchId: identity.branchId,
      actorUserId: identity.userId,
      servicePrincipalId: principal,
      operation,
      idempotencyKey: key,
      requestFingerprint: authoritativeRequestFingerprint(identityForTransaction(identity, principal), operation, normalizedSalesReturnForFingerprint(input)),
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: result });
  });
  return router;
}

function identityForTransaction(identity: { userId: string; organizationId: string; branchId: string }, servicePrincipalId: string) {
  return { organizationId: identity.organizationId, branchId: identity.branchId, actorUserId: identity.userId, servicePrincipalId };
}
