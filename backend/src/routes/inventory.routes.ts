import { Router } from "express";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { InventoryController } from "../controllers/inventory.controller.js";
import { SupabaseInventoryRepository } from "../repositories/inventory.repository.js";
import { InventoryService } from "../services/inventory.service.js";

export function createInventoryRouter(internalApiToken?: string, servicePrincipalId?: string): Router {
  const router = Router();
  const controller = new InventoryController(new InventoryService(new SupabaseInventoryRepository()));

  router.use(createInternalApiAuth(internalApiToken, servicePrincipalId));
  router.get("/balances", controller.listBalances);
  router.get("/balances/:productId/:warehouseId", controller.getBalance);
  router.get("/movements", controller.listMovements);

  return router;
}
