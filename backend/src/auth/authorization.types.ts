export const ERP_ROLES = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "sales",
  "purchase",
  "inventory",
  "viewer",
] as const;

export type ErpRole = (typeof ERP_ROLES)[number];

export type PermissionCode =
  | "customers.read"
  | "customers.write"
  | "vendors.read"
  | "vendors.write"
  | "products.read"
  | "products.write"
  | "inventory.read"
  | "inventory.adjust"
  | "purchases.read"
  | "purchases.create"
  | "purchases.approve"
  | "sales.read"
  | "sales.create"
  | "sales.approve"
  | "payments.create"
  | "returns.create"
  | "accounting.read"
  | "accounting.post"
  | "reports.view"
  | "organization.manage";

export interface AuthorizationContext {
  userId: string;
  organizationId: string;
  role: ErpRole;
  permission: PermissionCode;
}
