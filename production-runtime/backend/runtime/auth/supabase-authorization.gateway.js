import { env } from "../config/env.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
export class SupabaseAuthorizationGateway {
    client;
    constructor(client) {
        this.client = client;
    }
    async booleanRpc(name, args) {
        const { data, error } = (await this.client.rpc(name, args));
        if (error)
            throw new Error(`Authorization lookup failed: ${error.message}`);
        return data === true;
    }
    async isOrganizationMember(userId, organizationId) {
        if (!userId.trim() || !organizationId.trim())
            return false;
        return this.booleanRpc("is_organization_member_for_user", {
            p_user_id: userId,
            p_organization_id: organizationId,
        });
    }
    async hasPermission(userId, organizationId, permission) {
        if (!userId.trim() || !organizationId.trim() || !permission.trim())
            return false;
        return this.booleanRpc("has_permission_for_user", {
            p_user_id: userId,
            p_organization_id: organizationId,
            p_permission_code: permission,
        });
    }
    async hasBranchAccess(userId, organizationId, branchId) {
        if (!userId.trim() || !organizationId.trim() || !branchId.trim())
            return false;
        return this.booleanRpc("has_branch_access_for_user", {
            p_user_id: userId,
            p_organization_id: organizationId,
            p_branch_id: branchId,
        });
    }
}
export function createServiceRoleAuthorizationGateway() {
    return new SupabaseAuthorizationGateway(getSupabaseServiceRoleClient());
}
/**
 * P0-6 compatibility bridge for existing callers. It no longer constructs a
 * client from caller-supplied credentials: both values must match the validated
 * server environment, and the shared service-role client is returned.
 */
export function createAuthorizationClient(url, secretKey) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || url !== env.SUPABASE_URL || secretKey !== env.SUPABASE_SECRET_KEY) {
        throw new ApiError(503, "SERVICE_PRINCIPAL_MISMATCH", "Authorization client must use the configured backend service principal");
    }
    return getSupabaseServiceRoleClient();
}
//# sourceMappingURL=supabase-authorization.gateway.js.map