import type { PermissionCode } from "../auth/authorization.types.js";
import type { AssistantIntent } from "./assistant.types.js";

export const ASSISTANT_INTENT_PERMISSION: Record<AssistantIntent, PermissionCode> = {
  "reporting.query": "reports.view",
  "customer.lookup": "customers.read",
  "vendor.lookup": "vendors.read",
  "product.lookup": "products.read",
  "invoice.lookup": "sales.read",
  "estimate.lookup": "sales.read",
  "purchase.lookup": "purchases.read",
  "receivable.lookup": "reports.view",
  "payable.lookup": "reports.view",
  "inventory.lookup": "inventory.read",
  "estimate.create_draft": "sales.create",
  "invoice.create_draft": "sales.create",
  "customer_return.create_draft": "returns.create",
  "supplier_bill.create_draft": "purchases.create",
  "inventory.adjust_draft": "inventory.adjust",
};
