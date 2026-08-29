import type { PermissionCode } from "./authorization.types.js";

/** Organization membership is organization-wide. Branch access is never encoded here. */
export type TenantAccessContext = {
  userId: string;
  organizationId: string;
};

export type TenantAuthorizationScope =
  | { kind: "organization" }
  | { kind: "branch"; branchId: string | null | undefined };

export interface TenantAccessGateway {
  isOrganizationMember(userId: string, organizationId: string): Promise<boolean>;
  hasPermission(userId: string, organizationId: string, permission: PermissionCode): Promise<boolean>;
  hasBranchAccess(userId: string, organizationId: string, branchId: string): Promise<boolean>;
}
