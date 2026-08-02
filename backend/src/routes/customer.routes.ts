import { Router } from "express";
import { CustomerController } from "../controllers/customer.controller";

const router = Router();
const controller = new CustomerController();

console.log("✅ customer.routes.ts loaded");

// GET All Customers
router.get("/customers", (req, res) => {
  controller.getAll(req, res);
});

// POST New Customer
router.post("/customers", (req, res) => {
  controller.add(req, res);
});

export default router;