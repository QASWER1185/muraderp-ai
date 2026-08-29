import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

    if (error) {
      throw new Error(`Authorization lookup failed: ${error.message}`);
    }
    return data === true;
  }

  async isOrganizationMember(userId: string, organizationId: string): Promise<boolean> {
    if (!userId.trim() || !organizationId.trim()) return false;
    return this.booleanRpc("is_organization_member_for_user", {
      p_user_id: userId,
      p_organization_id: organizationId,
    });
  }

  async hasPermission(
    userId: string,
    organizationId: string,
    permission: PermissionCode,
  ): Promise<boolean> {
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

export function createAuthorizationClient(url: string, secretKey: string) {
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
