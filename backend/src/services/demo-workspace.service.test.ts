import { describe, expect, it, vi } from "vitest";
import { ensureDemoWorkspaceMembership, DEMO_BRANCH_ID, DEMO_ORGANIZATION_ID } from "./demo-workspace.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../types/database.types.js";

function fixture(email = "kelidexpipes@gmail.com", confirmed: string | null = "2026-01-01") {
  const tables = Object.fromEntries(["branches", "organization_memberships", "branch_access_grants"].map(name => {
    const builder = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), upsert: vi.fn().mockResolvedValue({ error: null }) };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder);
    return [name, builder];
  }));
  tables.branches!.maybeSingle.mockResolvedValue({ data: { id: DEMO_BRANCH_ID, organization_id: DEMO_ORGANIZATION_ID, status: "active" }, error: null });
  tables.organization_memberships!.maybeSingle.mockResolvedValue({ data: { role: "owner", status: "active" }, error: null });
  tables.branch_access_grants!.maybeSingle.mockResolvedValue({ data: null, error: null });
  const getUserById = vi.fn().mockResolvedValue({ data: { user: { email, email_confirmed_at: confirmed } }, error: null });
  const client = { auth: { admin: { getUserById } }, from: (name: string) => tables[name] } as unknown as SupabaseClient<Database>;
  return { client, tables, getUserById };
}
describe("allowlisted demo-owner onboarding", () => {
  it("links only the verified intended account using its actual user ID", async () => {
    const f = fixture();
    expect(await ensureDemoWorkspaceMembership(f.client, "actual-user", [])).toBe(true);
    expect(f.tables.organization_memberships!.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "actual-user", organization_id: DEMO_ORGANIZATION_ID, role: "owner" }), expect.objectContaining({ ignoreDuplicates: true }));
    expect(f.tables.branch_access_grants!.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "actual-user", branch_id: DEMO_BRANCH_ID }), expect.objectContaining({ ignoreDuplicates: true }));
  });
  it.each([["other@example.com", "confirmed"], ["kelidexpipes@gmail.com", null]])("never grants arbitrary or unconfirmed accounts demo-owner access", async (email, confirmed) => {
    const f = fixture(email!, confirmed);
    expect(await ensureDemoWorkspaceMembership(f.client, "user", [])).toBe(false);
    expect(f.tables.organization_memberships!.upsert).not.toHaveBeenCalled();
  });
  it("does not override existing suspended membership or an existing revoked branch grant", async () => {
    const f = fixture();
    expect(await ensureDemoWorkspaceMembership(f.client, "user", [{ organization_id: DEMO_ORGANIZATION_ID, role: "owner", status: "suspended" }])).toBe(false);
    expect(f.getUserById).not.toHaveBeenCalled();
    f.tables.branch_access_grants!.maybeSingle.mockResolvedValue({ data: { status: "revoked" }, error: null });
    expect(await ensureDemoWorkspaceMembership(f.client, "user", [{ organization_id: DEMO_ORGANIZATION_ID, role: "owner", status: "active" }])).toBe(false);
    expect(f.tables.branch_access_grants!.upsert).not.toHaveBeenCalled();
  });
});
