import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

type Membership = Pick<Database["public"]["Tables"]["organization_memberships"]["Row"], "organization_id" | "user_id" | "status">;
type Organization = Pick<Database["public"]["Tables"]["organizations"]["Row"], "id" | "name">;
type Grant = Pick<Database["public"]["Tables"]["branch_access_grants"]["Row"], "organization_id" | "branch_id" | "user_id" | "status">;
type Branch = Pick<Database["public"]["Tables"]["branches"]["Row"], "id" | "organization_id" | "name" | "status">;

export type DiscoveredWorkspace = { organizationId: string; organizationName: string; branches: { branchId: string; branchName: string }[] };

export function assembleAuthorizedWorkspaces(userId: string, memberships: Membership[], organizations: Organization[], grants: Grant[], branches: Branch[]): DiscoveredWorkspace[] {
  const activeOrgIds = new Set(memberships.filter((row) => row.user_id === userId && row.status === "active").map((row) => row.organization_id));
  const activeGrants = new Set(grants.filter((row) => row.user_id === userId && row.status === "active" && activeOrgIds.has(row.organization_id)).map((row) => `${row.organization_id}:${row.branch_id}`));
  return organizations.filter((row) => activeOrgIds.has(row.id)).map((organization) => ({
    organizationId: organization.id,
    organizationName: organization.name,
    branches: branches.filter((row) => row.organization_id === organization.id && row.status === "active" && activeGrants.has(`${organization.id}:${row.id}`))
      .map((row) => ({ branchId: row.id, branchName: row.name }))
      .sort((a, b) => a.branchName.localeCompare(b.branchName)),
  })).sort((a, b) => a.organizationName.localeCompare(b.organizationName));
}

export interface WorkspaceDiscoveryService { discover(userId: string): Promise<DiscoveredWorkspace[]> }

export class SupabaseWorkspaceDiscoveryService implements WorkspaceDiscoveryService {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  async discover(userId: string): Promise<DiscoveredWorkspace[]> {
    const client = this.clientFactory();
    const { data: memberships, error: membershipError } = await client.from("organization_memberships")
      .select("organization_id,user_id,status").eq("user_id", userId).eq("status", "active");
    if (membershipError) throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized organizations could not be loaded");
    const organizationIds = [...new Set((memberships ?? []).map((row) => row.organization_id))];
    if (organizationIds.length === 0) return [];

    const { data: organizations, error: organizationError } = await client.from("organizations")
      .select("id,name").in("id", organizationIds);
    if (organizationError) throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized organizations could not be loaded");
    const { data: grants, error: grantError } = await client.from("branch_access_grants")
      .select("organization_id,branch_id,user_id,status").eq("user_id", userId).eq("status", "active").in("organization_id", organizationIds);
    if (grantError) throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized branches could not be loaded");
    const branchIds = [...new Set((grants ?? []).map((row) => row.branch_id))];
    if (branchIds.length === 0) return assembleAuthorizedWorkspaces(userId, memberships ?? [], organizations ?? [], [], []);
    const { data: branches, error: branchError } = await client.from("branches")
      .select("id,organization_id,name,status").in("id", branchIds).eq("status", "active");
    if (branchError) throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized branches could not be loaded");
    return assembleAuthorizedWorkspaces(userId, memberships ?? [], organizations ?? [], grants ?? [], branches ?? []);
  }
}
