import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import type { PermissionCode } from "../auth/authorization.types.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import {
  SupabaseVendorPaymentBrowserRepository,
  type VendorPaymentBrowserRepository,
} from "../repositories/vendor-payment-browser.repository.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import { SupabaseVendorPaymentService, type VendorPaymentInput, type VendorPaymentService } from "../services/vendor-payment.service.js";
import { authoritativeRequestFingerprint, requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";
import { normalizedForFingerprint, requestSchema } from "./vendor-payment.routes.js";

const id = z.coerce.number().int().positive();
const page = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const operation = "vendor-payment.create" as const;

export interface VendorPaymentBrowserOptions {
  repository?: VendorPaymentBrowserRepository | undefined;
  service?: VendorPaymentService | undefined;
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

export function createVendorPaymentBrowserRouter(options: VendorPaymentBrowserOptions = {}): Router {
  const router = Router();
  const repository = options.repository ?? new SupabaseVendorPaymentBrowserRepository();
  const service = options.service ?? new SupabaseVendorPaymentService();
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

  router.get("/payables", async (request, response) => {
    const identity = await authorize(request, "payments.create");
    const query = page.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json(await repository.listPayables(identity.organizationId, identity.branchId, query.limit, query.cursor));
  });

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "payments.create");
    const query = page.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json(await repository.listPayments(identity.organizationId, identity.branchId, query.limit, query.cursor));
  });

  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "payments.create");
    const found = await repository.getPayment(identity.organizationId, identity.branchId, id.parse(request.params.id));
    if (!found) throw new ApiError(404, "NOT_FOUND", "Vendor payment was not found");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: found });
  });

  router.post("/", async (request, response) => {
    const identity = await authorize(request, "payments.create");
    const key = request.header("Idempotency-Key")?.trim();
    if (!key || key.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required");
    const input = normalizedForFingerprint(requestSchema.parse(request.body) as VendorPaymentInput);
    const purchaseIds = [...new Set(input.allocations.map((allocation) => allocation.purchase_id))];
    const purchases = await repository.allocationPurchases(identity.organizationId, identity.branchId, purchaseIds);
    if (purchases.length !== purchaseIds.length || purchases.some((purchase) => purchase.vendor_id !== input.vendor_id)) {
      throw new ApiError(403, "ALLOCATION_DENIED", "A purchase is outside this vendor or workspace");
    }
    const principal = normalizeServicePrincipalId(options.servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
    if (!principal) throw new ApiError(503, "ERP_NOT_CONFIGURED", "Vendor payment service principal is not configured");
    const transactionIdentity = {
      organizationId: identity.organizationId, branchId: identity.branchId,
      actorUserId: identity.userId, servicePrincipalId: principal,
    };
    const paymentId = await service.recordPayment(input, {
      ...transactionIdentity, operation, idempotencyKey: key,
      requestFingerprint: authoritativeRequestFingerprint(transactionIdentity, operation, input),
    });
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: { payment_id: paymentId } });
  });
  return router;
}
