import { ApiError } from "../errors/api-error.js";
import type { PermissionCode } from "./authorization.types.js";
import type { TenantAccessContext, TenantAccessGateway, TenantAuthorizationScope } from "./tenant-access.types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export class TenantAccessService {
  constructor(private readonly gateway: TenantAccessGateway) {}

  private requireTenantContext(context: TenantAccessContext | null | undefined): TenantAccessContext {
    if (!context || !isUuid(context.userId) || !isUuid(context.organizationId)) {
      throw new ApiError(
        401,
        "TENANT_CONTEXT_REQUIRED",
        "Authenticated user and explicit organization context are required",
      );
    }
    return {
      userId: context.userId.trim(),
      organizationId: context.organizationId.trim(),
    };
  }

  async assertOrganizationAccess(context: TenantAccessContext | null | undefined): Promise<void> {
    const tenant = this.requireTenantContext(context);
    const allowed = await this.gateway.isOrganizationMember(tenant.userId, tenant.organizationId);
    if (!allowed) {
      throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership is required");
    }
  }

  async assertPermission(
    context: TenantAccessContext | null | undefined,
    permission: PermissionCode,
  ): Promise<void> {
    const tenant = this.requireTenantContext(context);
    const member = await this.gateway.isOrganizationMember(tenant.userId, tenant.organizationId);
    if (!member) {
      throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership is required");
    }

    const allowed = await this.gateway.hasPermission(tenant.userId, tenant.organizationId, permission);
    if (!allowed) {
      throw new ApiError(403, "PERMISSION_DENIED", "Required organization permission is not granted");
    }
  }

  async assertBranchAccess(
    context: TenantAccessContext | null | undefined,
    branchId: string | null | undefined,
  ): Promise<void> {
    const tenant = this.requireTenantContext(context);
    if (!isUuid(branchId)) {
      throw new ApiError(403, "BRANCH_CONTEXT_REQUIRED", "Explicit branch context is required");
    }

    const member = await this.gateway.isOrganizationMember(tenant.userId, tenant.organizationId);
    if (!member) {
      throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership is required");
    }

    const allowed = await this.gateway.hasBranchAccess(
      tenant.userId,
      tenant.organizationId,
      branchId.trim(),
    );
    if (!allowed) {
      throw new ApiError(403, "BRANCH_ACCESS_DENIED", "Explicit active branch grant is required");
    }
  }

  async assertAuthorized(
    context: TenantAccessContext | null | undefined,
    permission: PermissionCode,
    scope: TenantAuthorizationScope,
  ): Promise<void> {
    await this.assertPermission(context, permission);
    if (scope.kind === "branch") {
      await this.assertBranchAccess(context, scope.branchId);
    }
  }
}
