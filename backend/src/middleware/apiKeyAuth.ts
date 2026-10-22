import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";

export type ApiKeyTenantContext = {
  organizationId: string;
  branchId: string;
  actorUserId: string;
};

export type DefaultApiKeyTenantContextLoader = () => Promise<ApiKeyTenantContext>;

const PRIMARY_ORGANIZATION_SLUG = "m-murad-building-materials-store";
const PRIMARY_BRANCH_CODE = "MAIN";
const DEFAULT_CONTEXT_CACHE_MS = 60_000;
let cachedDefaultContext: { value: ApiKeyTenantContext; expiresAt: number } | undefined;
let loadingDefaultContext: Promise<ApiKeyTenantContext> | undefined;

declare global {
  namespace Express {
    interface Request {
      apiKeyAuth?: boolean;
      apiKeyTenantContext?: ApiKeyTenantContext;
    }
  }
}

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Resolve the default tenant from live, active ERP records. Ambiguous or missing
 * records fail closed so a machine credential never drifts to another tenant.
 */
export const loadDefaultApiKeyTenantContext: DefaultApiKeyTenantContextLoader = async () => {
  if (cachedDefaultContext && cachedDefaultContext.expiresAt > Date.now()) return cachedDefaultContext.value;
  if (loadingDefaultContext) return loadingDefaultContext;

  loadingDefaultContext = (async () => {
    const client = getSupabaseServiceRoleClient();
    const organizationResult = await client.from("organizations").select("id")
      .eq("slug", PRIMARY_ORGANIZATION_SLUG).maybeSingle();
    if (organizationResult.error || !organizationResult.data) throw new Error("Primary organization is unavailable");

    const branchResult = await client.from("branches").select("id")
      .eq("organization_id", organizationResult.data.id).eq("code", PRIMARY_BRANCH_CODE)
      .eq("status", "active").is("archived_at", null).maybeSingle();
    if (branchResult.error || !branchResult.data) throw new Error("Primary branch is unavailable");

    const ownerResult = await client.from("organization_memberships").select("user_id")
      .eq("organization_id", organizationResult.data.id).eq("role", "owner").eq("status", "active").maybeSingle();
    if (ownerResult.error || !ownerResult.data) throw new Error("Active organization owner is unavailable");

    const context = {
      organizationId: organizationResult.data.id,
      branchId: branchResult.data.id,
      actorUserId: ownerResult.data.user_id,
    };
    cachedDefaultContext = { value: context, expiresAt: Date.now() + DEFAULT_CONTEXT_CACHE_MS };
    return context;
  })();

  try {
    return await loadingDefaultContext;
  } finally {
    loadingDefaultContext = undefined;
  }
};

function headerOrEmpty(request: Parameters<RequestHandler>[0], name: string): string {
  return request.header(name)?.trim() ?? "";
}

function setTenantHeaders(request: Parameters<RequestHandler>[0], context: ApiKeyTenantContext): void {
  request.headers["x-organization-id"] = context.organizationId;
  request.headers["x-branch-id"] = context.branchId;
  request.headers["x-actor-user-id"] = context.actorUserId;
  request.apiKeyTenantContext = context;
}

/** API keys authenticate the machine caller. Missing tenant headers default to
 * Murad's primary tenant, while supplied headers continue through tenant ACLs.
 */
export function createApiKeyAuth(loadDefaultContext: DefaultApiKeyTenantContextLoader = loadDefaultApiKeyTenantContext): RequestHandler {
  return (request, _response, next) => {
    const expectedKey = process.env.MURAD_API_KEY;
    const providedKey = request.header("X-API-Key");
    if (!expectedKey || !providedKey || !tokensMatch(providedKey, expectedKey)) {
      next();
      return;
    }

    request.apiKeyAuth = true;
    const supplied = {
      organizationId: headerOrEmpty(request, "X-Organization-Id"),
      branchId: headerOrEmpty(request, "X-Branch-Id"),
      actorUserId: headerOrEmpty(request, "X-Actor-User-Id"),
    };
    const missing = (Object.keys(supplied) as Array<keyof ApiKeyTenantContext>).some((key) => !supplied[key]);
    if (!missing) {
      setTenantHeaders(request, supplied);
      next();
      return;
    }

    void loadDefaultContext().then((defaults) => {
      const context = {
        organizationId: supplied.organizationId || defaults.organizationId,
        branchId: supplied.branchId || defaults.branchId,
        actorUserId: supplied.actorUserId || defaults.actorUserId,
      };
      setTenantHeaders(request, context);
      next();
    }).catch(() => {
      next(new ApiError(503, "API_KEY_TENANT_CONTEXT_UNAVAILABLE", "Default tenant context could not be resolved"));
    });
  };
}

export const apiKeyAuth: RequestHandler = createApiKeyAuth();
