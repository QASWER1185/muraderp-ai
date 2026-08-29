import { Router } from "express";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { ProductController } from "../controllers/product.controller.js";
import { SupabaseProductRepository } from "../repositories/product.repository.js";
import { ProductService } from "../services/product.service.js";

export function createProductRouter(internalApiToken?: string, servicePrincipalId?: string): Router {
  const router = Router();
  const controller = new ProductController(new ProductService(new SupabaseProductRepository()));
  const auth = createInternalApiAuth(internalApiToken, servicePrincipalId);

  router.use(auth);
  router.get("/", controller.list);
  router.get("/:id", controller.getById);
  router.post("/", controller.create);
  router.patch("/:id", controller.update);
  router.delete("/:id", controller.delete);

  return router;
}
