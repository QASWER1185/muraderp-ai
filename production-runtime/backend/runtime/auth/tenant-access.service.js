import { ApiError } from "../errors/api-error.js";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
    return typeof value === "string" && UUID_PATTERN.test(value.trim());
}
export class TenantAccessService {
    gateway;
    constructor(gateway) {
        this.gateway = gateway;
    }
    requireTenantContext(context) {
        if (!context || !isUuid(context.userId) || !isUuid(context.organizationId)) {
            throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and explicit organization context are required");
        }
        return {
            userId: context.userId.trim(),
            organizationId: context.organizationId.trim(),
        };
    }
    async assertOrganizationAccess(context) {
        const tenant = this.requireTenantContext(context);
        const allowed = await this.gateway.isOrganizationMember(tenant.userId, tenant.organizationId);
        if (!allowed) {
            throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership is required");
        }
    }
    async assertPermission(context, permission) {
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
    async assertBranchAccess(context, branchId) {
        const tenant = this.requireTenantContext(context);
        if (!isUuid(branchId)) {
            throw new ApiError(403, "BRANCH_CONTEXT_REQUIRED", "Explicit branch context is required");
        }
        const member = await this.gateway.isOrganizationMember(tenant.userId, tenant.organizationId);
        if (!member) {
            throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership is required");
        }
        const allowed = await this.gateway.hasBranchAccess(tenant.userId, tenant.organizationId, branchId.trim());
        if (!allowed) {
            throw new ApiError(403, "BRANCH_ACCESS_DENIED", "Explicit active branch grant is required");
        }
    }
    async assertAuthorized(context, permission, scope) {
        await this.assertPermission(context, permission);
        if (scope.kind === "branch") {
            await this.assertBranchAccess(context, scope.branchId);
        }
    }
}
//# sourceMappingURL=tenant-access.service.js.map