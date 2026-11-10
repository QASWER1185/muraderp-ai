import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import { ensureDemoWorkspaceMembership } from "./demo-workspace.service.js";
export function assembleAuthorizedWorkspaces(userId, memberships, organizations, grants, branches) {
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
export class SupabaseWorkspaceDiscoveryService {
    clientFactory;
    constructor(clientFactory = getSupabaseServiceRoleClient) {
        this.clientFactory = clientFactory;
    }
    async discover(userId) {
        const client = this.clientFactory();
        let { data: memberships, error: membershipError } = await client.from("organization_memberships")
            .select("organization_id,user_id,status,role").eq("user_id", userId);
        if (membershipError)
            throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized organizations could not be loaded");
        if (await ensureDemoWorkspaceMembership(client, userId, memberships ?? [])) {
            const refreshed = await client.from("organization_memberships").select("organization_id,user_id,status,role").eq("user_id", userId);
            if (refreshed.error)
                throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "The new demo workspace could not be loaded. Refresh to retry.");
            memberships = refreshed.data;
        }
        const organizationIds = [...new Set((memberships ?? []).filter(row => row.status === "active").map((row) => row.organization_id))];
        if (organizationIds.length === 0)
            return [];
        const { data: organizations, error: organizationError } = await client.from("organizations")
            .select("id,name").in("id", organizationIds);
        if (organizationError)
            throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized organizations could not be loaded");
        const { data: grants, error: grantError } = await client.from("branch_access_grants")
            .select("organization_id,branch_id,user_id,status").eq("user_id", userId).eq("status", "active").in("organization_id", organizationIds);
        if (grantError)
            throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized branches could not be loaded");
        const branchIds = [...new Set((grants ?? []).map((row) => row.branch_id))];
        if (branchIds.length === 0)
            return assembleAuthorizedWorkspaces(userId, memberships ?? [], organizations ?? [], [], []);
        const { data: branches, error: branchError } = await client.from("branches")
            .select("id,organization_id,name,status").in("id", branchIds).eq("status", "active");
        if (branchError)
            throw new ApiError(502, "WORKSPACE_DISCOVERY_FAILED", "Authorized branches could not be loaded");
        return assembleAuthorizedWorkspaces(userId, memberships ?? [], organizations ?? [], grants ?? [], branches ?? []);
    }
}
//# sourceMappingURL=workspace-discovery.service.js.map