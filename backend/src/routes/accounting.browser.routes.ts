import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseAccountingBrowserRepository, type AccountingBrowserRepository } from "../repositories/accounting-browser.repository.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const uuid = z.string().uuid();
const page = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) });

export interface AccountingBrowserOptions {
  repository?: AccountingBrowserRepository | undefined;
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
  return {
    userId: request.browserPrincipal.userId,
    organizationId: uuid.parse(request.header("X-Organization-Id")),
    branchId: uuid.parse(request.header("X-Branch-Id")),
  };
}

export function createAccountingBrowserRouter(options: AccountingBrowserOptions = {}): Router {
  const router = Router();
  const repository = options.repository ?? new SupabaseAccountingBrowserRepository();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let authorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorize(request: Request) {
    const identity = identityFor(request);
    authorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await authorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId },
      "accounting.read", { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/accounts", async (request, response) => {
    await authorize(request);
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: await repository.listAccounts() });
  });
  router.get("/entries", async (request, response) => {
    const identity = await authorize(request);
    const { limit, offset } = page.parse(request.query);
    response.setHeader("Cache-Control", "no-store");
    response.json(await repository.listEntries(identity, limit, offset));
  });
  router.get("/entries/:id", async (request, response) => {
    const identity = await authorize(request);
    const entry = await repository.getEntry(identity, uuid.parse(request.params.id));
    if (!entry) throw new ApiError(404, "JOURNAL_ENTRY_NOT_FOUND", "Journal entry was not found in this branch");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: entry });
  });
  router.get("/accounts/:id/ledger", async (request, response) => {
    const identity = await authorize(request);
    const { limit, offset } = page.parse(request.query);
    const ledger = await repository.listLedger(identity, uuid.parse(request.params.id), limit, offset);
    if (!ledger) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Account was not found");
    response.setHeader("Cache-Control", "no-store");
    response.json(ledger);
  });
  return router;
}
