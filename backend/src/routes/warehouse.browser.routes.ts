import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import type { PermissionCode } from "../auth/authorization.types.js";
import { ApiError } from "../errors/api-error.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { SupabaseErpService, type ErpService } from "../services/erp.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

const id = z.coerce.number().int().positive();
const page = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const warehouse = z.strictObject({ name: z.string().trim().min(1).max(200), location: z.string().trim().min(1).max(500).nullable().optional() });
const patch = warehouse.partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
type WarehouseService = Pick<ErpService, "listWarehouses" | "getWarehouse" | "createWarehouse" | "updateWarehouse">;

export interface WarehouseBrowserOptions {
  service?: WarehouseService | undefined;
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
  const actor = request.header("X-Actor-User-Id");
  if (actor && actor !== request.browserPrincipal.userId) throw new ApiError(403, "FORBIDDEN", "Actor does not match authenticated session");
  const origin = request.header("Origin");
  if (request.header("Sec-Fetch-Site") === "cross-site" || (origin && new URL(origin).host !== request.get("host"))) throw new ApiError(403, "FORBIDDEN", "Same-origin request required");
  return {
    userId: request.browserPrincipal.userId,
    organizationId: z.string().uuid().parse(request.header("X-Organization-Id")),
    branchId: z.string().uuid().parse(request.header("X-Branch-Id")),
  };
}

export function createWarehouseBrowserRouter(options: WarehouseBrowserOptions = {}): Router {
  const router = Router();
  const service = options.service ?? new SupabaseErpService();
  const authenticate = options.authenticate ?? createCopilotAuth(options.internalApiToken, options.servicePrincipalId);
  let tenantAuthorizer = options.tenantAuthorizer;
  router.use(authenticate);

  async function authorize(request: Request, permission: PermissionCode) {
    const identity = identityFor(request);
    tenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await tenantAuthorizer.assertAuthorized(
      { userId: identity.userId, organizationId: identity.organizationId }, permission,
      { kind: "branch", branchId: identity.branchId },
    );
    return identity;
  }

  router.get("/", async (request, response) => {
    const identity = await authorize(request, "inventory.read");
    response.json(await service.listWarehouses(page.parse(request.query), identity.organizationId));
  });
  router.get("/:id", async (request, response) => {
    const identity = await authorize(request, "inventory.read");
    const found = await service.getWarehouse(id.parse(request.params.id), identity.organizationId);
    if (!found) throw new ApiError(404, "NOT_FOUND", "Warehouse was not found");
    response.json({ data: found });
  });
  router.post("/", async (request, response) => {
    const identity = await authorize(request, "inventory.adjust");
    response.status(201).json({ data: await service.createWarehouse(warehouse.parse(request.body), identity.organizationId) });
  });
  router.patch("/:id", async (request, response) => {
    const identity = await authorize(request, "inventory.adjust");
    const found = await service.updateWarehouse(id.parse(request.params.id), patch.parse(request.body), identity.organizationId);
    if (!found) throw new ApiError(404, "NOT_FOUND", "Warehouse was not found");
    response.json({ data: found });
  });
  return router;
}
