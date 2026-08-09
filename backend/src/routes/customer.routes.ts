import { Router } from "express";
import { CustomerController } from "../controllers/customer.controller.js";

const router = Router();
const controller = new CustomerController();

router.get("/customers", (request, response) => controller.getAll(request, response));
router.post("/customers", (request, response) => controller.add(request, response));
router.put("/customers/:id", (request, response) => controller.update(request, response));
router.delete("/customers/:id", (request, response) => controller.delete(request, response));

export default router;
