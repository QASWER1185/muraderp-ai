import { describe, expect, it } from "vitest";
import { TenantAccessService } from "../src/auth/tenant-access.service.js";
import type { PermissionCode } from "../src/auth/authorization.types.js";
import type { TenantAccessGateway } from "../src/auth/tenant-access.types.js";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BRANCH_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BRANCH_B = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";

class DeterministicGateway implements TenantAccessGateway {
  memberships = new Set([`${USER}:${ORG_A}`]);
  permissions = new Set([`${USER}:${ORG_A}:sales.read`]);
  branchGrants = new Set([`${USER}:${ORG_A}:${BRANCH_A}`]);

  async isOrganizationMember(userId: string, organizationId: string) {
    return this.memberships.has(`${userId}:${organizationId}`);
  }
  async hasPermission(userId: string, organizationId: string, permission: PermissionCode) {
    return this.permissions.has(`${userId}:${organizationId}:${permission}`);
  }
  async hasBranchAccess(userId: string, organizationId: string, branchId: string) {
    return this.branchGrants.has(`${userId}:${organizationId}:${branchId}`);
  }
}

const context = { userId: USER, organizationId: ORG_A };

describe("P0-5 tenant access foundation", () => {
  it("allows an active organization member", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertOrganizationAccess(context)).resolves.toBeUndefined();
  });

  it("denies a non-member", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertOrganizationAccess({ ...context, organizationId: ORG_B })).rejects.toMatchObject({ code: "ORGANIZATION_ACCESS_DENIED" });
  });

  it("allows an explicit branch grant", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertBranchAccess(context, BRANCH_A)).resolves.toBeUndefined();
  });

  it("denies branch access without an explicit grant", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertBranchAccess(context, BRANCH_B)).rejects.toMatchObject({ code: "BRANCH_ACCESS_DENIED" });
  });

  it("denies a cross-organization branch request", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertBranchAccess({ ...context, organizationId: ORG_B }, BRANCH_A)).rejects.toMatchObject({ code: "ORGANIZATION_ACCESS_DENIED" });
  });

  it("does not treat null or absent branch context as wildcard access", async () => {
    const service = new TenantAccessService(new DeterministicGateway());
    await expect(service.assertBranchAccess(context, null)).rejects.toMatchObject({ code: "BRANCH_CONTEXT_REQUIRED" });
    await expect(service.assertBranchAccess(context, undefined)).rejects.toMatchObject({ code: "BRANCH_CONTEXT_REQUIRED" });
  });

  it("denies an invalid organization/branch relationship", async () => {
    const gateway = new DeterministicGateway();
    gateway.memberships.add(`${USER}:${ORG_B}`);
    await expect(new TenantAccessService(gateway).assertBranchAccess({ ...context, organizationId: ORG_B }, BRANCH_A)).rejects.toMatchObject({ code: "BRANCH_ACCESS_DENIED" });
  });

  it("denies an unauthorized role/permission", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertPermission(context, "accounting.post")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("fails closed when tenant context is missing", async () => {
    await expect(new TenantAccessService(new DeterministicGateway()).assertOrganizationAccess(null)).rejects.toMatchObject({ code: "TENANT_CONTEXT_REQUIRED" });
  });
});
