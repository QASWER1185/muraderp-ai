import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import type { AuthorizationGateway } from "./authorization.service.js";
import type { PermissionCode } from "./authorization.types.js";

export class SupabaseAuthorizationGateway implements AuthorizationGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async hasPermission(
    userId: string,
    organizationId: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    if (!userId.trim()) return false;

    const { data, error } = (await this.client.rpc(
      "has_permission_for_user" as never,
      {
        p_user_id: userId,
        p_organization_id: organizationId,
        p_permission_code: permission,
      } as never,
    )) as { data: boolean | null; error: { message: string } | null };

    if (error) {
      throw new Error(`Authorization lookup failed: ${error.message}`);
    }

    return data === true;
  }
}

export function createAuthorizationClient(url: string, secretKey: string) {
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
