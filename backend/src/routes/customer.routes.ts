import { Router } from "express";
import { CustomerController } from "../controllers/customer.controller";

console.log("✅ customer.routes.ts loaded");

const router = Router();
const controller = new CustomerController();

router.get("/customers", (_req, res) => {
  console.log("✅ /api/customers route called");
  controller.getAll(_req, res);
});

export default router;