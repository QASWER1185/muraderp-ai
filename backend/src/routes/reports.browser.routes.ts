import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { AuthorizationService, type AuthorizationGateway } from "../auth/authorization.service.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { DASHBOARD_HEADS } from "../reports/dashboard.types.js";
import { ReportingService } from "../reports/reporting.service.js";
import { SupabaseReportingGateway } from "../reports/supabase-reporting.gateway.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const uuid = z.string().uuid();
const periodQuery = z.object({ from: z.string().date(), to: z.string().date() }).refine((value) => value.from <= value.to, "From date must not exceed to date");
const detailQuery = z.object({ head: z.enum(DASHBOARD_HEADS), from: z.string().date(), to: z.string().date() }).refine((value) => value.from <= value.to, "From date must not exceed to date");
type Gateway = Pick<SupabaseReportingGateway, "getFinancialSummary" | "getDashboardSummary" | "getDashboardDetail" | "getTrialBalance">;

export interface ReportsBrowserOptions {
  gatewayFactory?: ((branchId: string) => Gateway) | undefined;
  permissionGateway?: AuthorizationGateway | undefined;
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
  const sameHost = originHost === request.get("host");
  const sameProxiedHost = fetchSite === "same-origin" && originHost === request.header("X-Forwarded-Host")?.trim();
  if (fetchSite === "cross-site" || (origin && (!originHost || (!sameHost && !sameProxiedHost)))) {
    throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  }
  const actor = request.header("X-Actor-User-Id")?.trim();
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  return { userId: request.browserPrincipal.userId, organizationId: uuid.parse(request.header("X-Organization-Id")), branchId: uuid.parse(request.header("X-Branch-Id")) };
}

export function createReportsBrowserRouter(options: ReportsBrowserOptions = {}): Router {
  const router = Router();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let authorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorized(request: Request) {
    const identity = identityFor(request);
    authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized({ userId: identity.userId, organizationId: identity.organizationId }, "reports.view", { kind: "branch", branchId: identity.branchId });
    const gateway = options.gatewayFactory?.(identity.branchId) ?? new SupabaseReportingGateway(identity.branchId);
    const service = new ReportingService(gateway, new AuthorizationService(options.permissionGateway ?? createServiceRoleAuthorizationGateway()));
    return { identity, gateway, service };
  }

  router.get("/overview", async (request, response) => {
    const { identity, service } = await authorized(request);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await service.getDashboardOverview(identity.userId, identity.organizationId) });
  });
  router.get("/summary", async (request, response) => {
    const { identity, service } = await authorized(request);
    const period = periodQuery.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await service.getFinancialSummary(identity.userId, identity.organizationId, period) });
  });
  router.get("/details", async (request, response) => {
    const { identity, service } = await authorized(request);
    const { head, from, to } = detailQuery.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await service.getDashboardDetail(identity.userId, identity.organizationId, head, { from, to }) });
  });
  router.get("/trial-balance", async (request, response) => {
    const { identity, gateway } = await authorized(request);
    const period = periodQuery.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await gateway.getTrialBalance(identity.organizationId, period), as_of: period.to });
  });
  return router;
}
