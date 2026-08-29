import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationName = "20260829062845_p0_5_membership_branch_access_foundation.sql";
const migrationPath = resolve(root, "supabase/migrations", migrationName);
const migration = readFileSync(migrationPath, "utf8");
const tenantService = readFileSync(resolve(root, "backend/src/auth/tenant-access.service.ts"), "utf8");
const compatibilityBoundary = readFileSync(resolve(root, "backend/src/auth/phase21-org-context.ts"), "utf8");
const failures = [];
const fail = (message) => failures.push(message);

const version = migrationName.slice(0, 14);
if (!(version > "20260824170000")) fail("migration version must be above the architect floor");
if (!(version > "20260828182231")) fail("P0-5 migration must follow P0-4 branch foundation");

const stripped = migration.replace(/--.*$/gm, "");
if (/^\s*(insert\s+into|update\s+public\.|delete\s+from|merge\s+into)\b/im.test(stripped)) {
  fail("P0-5 migration must not mutate business data");
}
if (/alter\s+table\s+public\.organization_memberships[\s\S]{0,200}add\s+column\s+branch_id/i.test(stripped)) {
  fail("organization membership must remain branch-independent");
}
if (/security\s+definer/i.test(stripped)) fail("P0-5 service authorization helpers must not be SECURITY DEFINER");

for (const functionName of [
  "is_organization_member_for_user",
  "has_permission_for_user",
  "has_branch_access_for_user",
]) {
  if (!migration.includes(`function public.${functionName}`)) fail(`missing ${functionName} function`);
  if (!new RegExp(`revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated`, "i").test(migration)) {
    fail(`${functionName} must be revoked from public/anon/authenticated`);
  }
  if (!new RegExp(`grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role`, "i").test(migration)) {
    fail(`${functionName} must be service_role-only`);
  }
}

for (const invariant of [
  "create policy memberships_select_self on public.organization_memberships",
  "to authenticated",
  "user_id = (select auth.uid())",
  "om.status = 'active'",
  "bag.status = 'active'",
  "b.status = 'active'",
  "p_branch_id is not null",
]) {
  if (!migration.includes(invariant)) fail(`missing authorization invariant: ${invariant}`);
}

if (/memberships_select_self_or_same_org[\s\S]*?create policy memberships_select_self_or_same_org/i.test(migration)) {
  fail("recursive same-organization membership policy must not be recreated");
}

if (!tenantService.includes("TENANT_CONTEXT_REQUIRED")) fail("tenant context must fail closed");
if (!tenantService.includes("ORGANIZATION_ACCESS_DENIED")) fail("organization membership denial is required");
if (!tenantService.includes("BRANCH_CONTEXT_REQUIRED")) fail("explicit branch context is required");
if (!tenantService.includes("BRANCH_ACCESS_DENIED")) fail("branch grant denial is required");
if (!tenantService.includes("PERMISSION_DENIED")) fail("permission denial is required");

if (!compatibilityBoundary.includes("A null/absent active branch is never wildcard authority")) {
  fail("Phase 21 compatibility boundary must explicitly reject null-branch wildcard semantics");
}
if (/null active branch intentionally represents organization-scoped access/i.test(compatibilityBoundary)) {
  fail("deprecated null-branch wildcard semantics remain");
}

if (failures.length > 0) {
  console.error("P0_5_AUTHORIZATION_FOUNDATION_INVALID");
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}

console.log("P0_5_AUTHORIZATION_FOUNDATION_VALID");
console.log(`MIGRATION=${migrationName}`);
console.log("ORGANIZATION_MEMBERSHIP=EXPLICIT_ACTIVE");
console.log("BRANCH_ACCESS=EXPLICIT_ACTIVE_GRANT");
console.log("NULL_BRANCH_WILDCARD=DENIED");
console.log("SERVICE_RPCS=SERVICE_ROLE_ONLY");
console.log("PRODUCTION_DATA_DML=NONE");
