import { Router } from "express";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { InventoryController } from "../controllers/inventory.controller.js";
import { SupabaseInventoryRepository } from "../repositories/inventory.repository.js";
import { InventoryService } from "../services/inventory.service.js";
import { createServiceRoleAuthorizationGateway } from "../auth/supabase-authorization.gateway.js";
import { TenantAccessService } from "../auth/tenant-access.service.js";
import { requireAuthoritativeTransactionIdentity } from "./authoritative-transaction-context.js";

export function createInventoryRouter(
  internalApiToken?: string,
  servicePrincipalId?: string,
  tenantAuthorizer?: Pick<TenantAccessService, "assertAuthorized">,
): Router {
  const router = Router();
  const controller = new InventoryController(new InventoryService(new SupabaseInventoryRepository()));
  let inventoryTenantAuthorizer = tenantAuthorizer;

  router.use(createInternalApiAuth(internalApiToken, servicePrincipalId));
  router.use(async (request, _response, next) => {
    const identity = requireAuthoritativeTransactionIdentity(request);
    inventoryTenantAuthorizer ??= new TenantAccessService(createServiceRoleAuthorizationGateway());
    await inventoryTenantAuthorizer.assertAuthorized(
      { userId: identity.actorUserId, organizationId: identity.organizationId },
      "inventory.read",
      { kind: "branch", branchId: identity.branchId },
    );
    request.organizationContext = {
      userId: identity.actorUserId,
      organizationId: identity.organizationId,
      branchId: identity.branchId,
    };
    next();
  });
  router.get("/balances", controller.listBalances);
  router.get("/balances/:productId/:warehouseId", controller.getBalance);
  router.get("/movements", controller.listMovements);

  return router;
}
