import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";
import type { AuthorizationGateway } from "./authorization.service.js";
import type { PermissionCode } from "./authorization.types.js";
import type { TenantAccessGateway } from "./tenant-access.types.js";

export class SupabaseAuthorizationGateway implements AuthorizationGateway, TenantAccessGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  private async booleanRpc(name: string, args: Record<string, string>): Promise<boolean> {
    const { data, error } = (await this.client.rpc(name as never, args as never)) as {
      data: boolean | null;
      error: { message: string } | null;
    };
    if (error) throw new Error(`Authorization lookup failed: ${error.message}`);
    return data === true;
  }

  async isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
    if (!userId.trim() || !organizationId.trim()) return false;
    return this.booleanRpc("is_organization_member_for_user", {
      p_user_id: userId,
      p_organization_id: organizationId,
    });
  }

  async hasPermission(userId: string, organizationId: string, permission: PermissionCode): Promise<boolean> {
    if (!userId.trim() || !organizationId.trim() || !permission.trim()) return false;
    return this.booleanRpc("has_permission_for_user", {
      p_user_id: userId,
      p_organization_id: organizationId,
      p_permission_code: permission,
    });
  }

  async hasBranchAccess(userId: string, organizationId: string, branchId: string): Promise<boolean> {
    if (!userId.trim() || !organizationId.trim() || !branchId.trim()) return false;
    return this.booleanRpc("has_branch_access_for_user", {
      p_user_id: userId,
      p_organization_id: organizationId,
      p_branch_id: branchId,
    });
  }
}

export function createServiceRoleAuthorizationGateway(): SupabaseAuthorizationGateway {
  return new SupabaseAuthorizationGateway(getSupabaseServiceRoleClient());
}

/**
 * P0-6 compatibility bridge for existing callers. It no longer constructs a
 * client from caller-supplied credentials: both values must match the validated
 * server environment, and the shared service-role client is returned.
 */
export function createAuthorizationClient(url: string, secretKey: string): SupabaseClient<Database> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY || url !== env.SUPABASE_URL || secretKey !== env.SUPABASE_SECRET_KEY) {
    throw new ApiError(503, "SERVICE_PRINCIPAL_MISMATCH", "Authorization client must use the configured backend service principal");
  }
  return getSupabaseServiceRoleClient();
}
