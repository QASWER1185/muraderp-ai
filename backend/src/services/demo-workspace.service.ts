import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";
import { ApiError } from "../errors/api-error.js";

export const DEMO_ORGANIZATION_ID = "d3000000-0000-4000-8000-000000000001";
export const DEMO_BRANCH_ID = "d3000000-0000-4000-8000-000000000002";
const DEMO_OWNER_EMAIL = "kelidexpipes@gmail.com";
type Membership = { organization_id: string; status: string; role: string };

/** Server-only, explicit demo-owner onboarding. Never trust a client email or revive revoked access. */
export async function ensureDemoWorkspaceMembership(client: SupabaseClient<Database>, userId: string, memberships: Membership[]): Promise<boolean> {
  const demoOwner = memberships.find(row => row.organization_id === DEMO_ORGANIZATION_ID && row.role === "owner" && row.status === "active");
  if (memberships.length && !demoOwner) return false;
  const { data: identity, error: identityError } = await client.auth.admin.getUserById(userId);
  if (identityError) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "The authenticated demo account could not be verified. Retry workspace discovery.");
  if (identity.user?.email?.toLowerCase() !== DEMO_OWNER_EMAIL || !identity.user.email_confirmed_at) return false;
  const { data: branch, error: branchError } = await client.from("branches").select("id,organization_id,status").eq("id", DEMO_BRANCH_ID).maybeSingle();
  if (branchError) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "The demo branch could not be checked.");
  if (!branch || branch.organization_id !== DEMO_ORGANIZATION_ID || branch.status !== "active") return false;
  if (!demoOwner) {
    const { error } = await client.from("organization_memberships").upsert({ organization_id: DEMO_ORGANIZATION_ID, user_id: userId, role: "owner", status: "active" }, { onConflict: "organization_id,user_id", ignoreDuplicates: true });
    if (error) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "Demo organization access could not be created. Retry workspace discovery.");
  }
  // Re-read after an insert race; never overwrite an administrator's role or suspension.
  const { data: membership, error: membershipError } = await client.from("organization_memberships").select("role,status").eq("organization_id", DEMO_ORGANIZATION_ID).eq("user_id", userId).maybeSingle();
  if (membershipError) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "Demo membership could not be verified.");
  if (membership?.role !== "owner" || membership.status !== "active") return false;
  const { data: grant, error: grantError } = await client.from("branch_access_grants").select("status").eq("organization_id", DEMO_ORGANIZATION_ID).eq("branch_id", DEMO_BRANCH_ID).eq("user_id", userId).maybeSingle();
  if (grantError) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "Demo branch access could not be checked.");
  if (grant) return false;
  const { error } = await client.from("branch_access_grants").upsert({ organization_id: DEMO_ORGANIZATION_ID, branch_id: DEMO_BRANCH_ID, user_id: userId, status: "active" }, { onConflict: "organization_id,branch_id,user_id", ignoreDuplicates: true });
  if (error) throw new ApiError(502, "WORKSPACE_PROVISIONING_FAILED", "Demo branch access could not be created. Refresh to retry; organization access is preserved.");
  return true;
}
