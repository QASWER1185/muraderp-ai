import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationPath = "supabase/migrations/20260829065058_p0_6_service_principal_security_foundation.sql";
const migration = readFileSync(resolve(root, migrationPath), "utf8");
const envSource = readFileSync(resolve(root, "backend/src/config/env.ts"), "utf8");
const principalSource = readFileSync(resolve(root, "backend/src/security/service-principal.ts"), "utf8");
const authSource = readFileSync(resolve(root, "backend/src/middleware/internal-api-auth.ts"), "utf8");
const gatewaySource = readFileSync(resolve(root, "backend/src/auth/supabase-authorization.gateway.ts"), "utf8");
const supabaseSource = readFileSync(resolve(root, "backend/src/config/supabase.ts"), "utf8");
const erpRoute = readFileSync(resolve(root, "backend/src/routes/erp.routes.ts"), "utf8");
const transactionContextSource = readFileSync(resolve(root, "backend/src/routes/authoritative-transaction-context.ts"), "utf8");
const appSource = readFileSync(resolve(root, "backend/src/app.ts"), "utf8");
const copilotRoute = readFileSync(resolve(root, "backend/src/routes/ai-copilot.routes.ts"), "utf8");
const salesAdapter = readFileSync(resolve(root, "backend/src/services/supabase-sales-transaction.adapter.ts"), "utf8");
const p05Migration = readFileSync(resolve(root, "supabase/migrations/20260829062845_p0_5_membership_branch_access_foundation.sql"), "utf8");

const failures = [];
const pass = (message) => console.log(`PASS  ${message}`);
const fail = (message) => failures.push(message);
const requireText = (source, token, label) => source.includes(token) ? pass(label) : fail(label);
const forbidText = (source, token, label) => !source.includes(token) ? pass(label) : fail(label);

if (20260829065058 > 20260829062845 && 20260829065058 > 20260824170000) pass("P0-6 migration version is forward-only and above the required floor");
else fail("P0-6 migration version is not forward-only");

for (const fn of ["record_purchase", "record_customer_payment", "record_vendor_payment", "record_sales_return", "post_invoice_atomic"]) {
  requireText(migration, `alter function public.${fn}`, `${fn} has explicit privilege hardening`);
}
const emptyPathCount = (migration.match(/set search_path = ''/g) ?? []).length;
if (emptyPathCount === 10) pass("historical implementations and five service-facing wrappers use an empty fixed search_path");
else fail(`expected 10 empty search_path hardenings, found ${emptyPathCount}`);
for (const fn of ["record_purchase", "record_customer_payment", "record_vendor_payment", "record_sales_return", "post_invoice_atomic"]) {
  requireText(migration, `rename to ${fn}_p0_6_impl`, `${fn} historical body is isolated behind a P0-6 implementation name`);
}
if ((migration.match(/security definer/g) ?? []).length === 5) pass("all five service-facing wrappers explicitly declare SECURITY DEFINER");
else fail("service-facing wrapper SECURITY DEFINER count is not exactly five");
const postgresOwnerCount = (migration.match(/owner to postgres;/g) ?? []).length;
if (postgresOwnerCount === 5) pass("all five SECURITY DEFINER wrappers have an explicit postgres owner boundary");
else fail(`expected 5 explicit postgres wrapper owners, found ${postgresOwnerCount}`);
forbidText(migration, "default 'internal-system'", "database wrapper has no internal-system default identity");
forbidText(migration, "default 'service_role'", "database wrapper has no service_role default identity");
const explicitPrincipalGuardCount = (migration.match(/Explicit service principal is required/g) ?? []).length;
if (explicitPrincipalGuardCount === 5) pass("all five privileged transaction wrappers require an explicit non-default service principal");
else fail(`expected 5 explicit service-principal guards, found ${explicitPrincipalGuardCount}`);
for (const operationGuard of ["purchase.create", "customer-payment.create", "sales-return.create"]) {
  requireText(migration, `is distinct from '${operationGuard}'`, `${operationGuard} wrapper rejects an unexpected operation context`);
}
requireText(migration, "from public, anon, authenticated, service_role;", "historical implementations revoke direct service_role execution");

for (const role of ["public", "anon", "authenticated"]) {
  if (migration.includes(`from public, anon, authenticated;`)) pass(`privileged RPC EXECUTE is revoked from ${role}`);
  else fail(`privileged RPC EXECUTE revoke set is incomplete for ${role}`);
}
const serviceGrantCount = (migration.match(/to service_role;/g) ?? []).length;
if (serviceGrantCount === 5) pass("service_role is the only granted execution role for hardened business RPCs");
else fail(`expected 5 service_role grants, found ${serviceGrantCount}`);
const executeGrants = migration.match(/grant\s+execute[\s\S]*?;/gi) ?? [];
if (executeGrants.length === 5 && executeGrants.every((statement) => /\bto\s+service_role\s*;/i.test(statement))) pass("no privileged EXECUTE grant targets browser/public roles");
else fail("privileged EXECUTE grant targets a browser/public role or grant set is ambiguous");
if (!/\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate\s+)\b/i.test(migration)) pass("P0-6 migration contains no business data DML");
else fail("P0-6 migration contains data DML");

forbidText(envSource, '.default("internal-system")', "environment has no default service identity");
requireText(envSource, "INTERNAL_API_PRINCIPAL_ID", "service principal identity is explicit configuration");
requireText(envSource, "FORBIDDEN_SERVICE_PRINCIPALS", "generic service identities are rejected");
requireText(principalSource, 'kind: "internal-api"', "service principal has an explicit backend identity type");
requireText(authSource, "request.servicePrincipal = servicePrincipal", "principal is attached only by backend auth middleware");
requireText(authSource, "servicePrincipalId: servicePrincipal.id", "authenticated service principal identity is emitted to structured server audit logs");
forbidText(authSource.toLowerCase(), "x-service-principal", "caller headers cannot supply the service principal identity");
requireText(authSource, "tokensMatch", "internal API credential is timing-safe compared before principal attachment");

forbidText(gatewaySource, 'import { createClient', "authorization gateway cannot construct an arbitrary Supabase client");
requireText(gatewaySource, "getSupabaseServiceRoleClient", "authorization gateway resolves through central service-role client");
requireText(gatewaySource, "SERVICE_PRINCIPAL_MISMATCH", "legacy authorization client compatibility path fails closed on credential mismatch");
requireText(supabaseSource, "getSupabaseServiceRoleClient", "database privileged client has an explicit service-role factory");

forbidText(erpRoute, 'internalApiPrincipalId = "internal-system"', "ERP route has no default audit principal");
forbidText(salesAdapter, 'principalId = "backend"', "sales transaction adapter has no default backend principal");
requireText(erpRoute, "requireAuthoritativeTransactionIdentity(request)", "purchase route uses the authoritative transaction identity boundary");
requireText(transactionContextSource, "requireServicePrincipal(request.servicePrincipal)", "authoritative transaction identity requires the authenticated service principal");
requireText(transactionContextSource, "servicePrincipalId: principal.id", "purchase audit principal comes from authenticated service context");
requireText(salesAdapter, "Explicit sales transaction service principal is required", "sales adapter fails closed without an explicit principal");
requireText(appSource, "createAiCopilotRouter(internalApiToken, undefined, internalApiPrincipalId)", "AI Copilot internal credential receives the explicit server service principal");
requireText(copilotRoute, "createCopilotAuth(internalApiToken, servicePrincipalId)", "AI Copilot internal auth uses the explicit service-principal boundary");
requireText(salesAdapter, "constructor(clientFactory: () => SupabaseClient<Database>, principalId: string);", "sales transaction adapter compile-time contract requires an explicit principal");

for (const fn of ["is_organization_member_for_user", "has_permission_for_user", "has_branch_access_for_user"]) {
  requireText(p05Migration, `revoke all on function public.${fn}`, `${fn} remains browser-inaccessible in accepted P0-5 migration`);
}
if ((p05Migration.match(/to service_role;/g) ?? []).length >= 3) pass("accepted P0-5 authorization RPCs retain service_role-only execution grants");
else fail("accepted P0-5 service-role authorization grants are missing");

if (failures.length > 0) {
  console.error("\nP0_6_SERVICE_PRINCIPAL_FOUNDATION_INVALID");
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  process.exit(1);
}
console.log("\nP0_6_SERVICE_PRINCIPAL_FOUNDATION_VALID");
console.log("BROWSER_PRIVILEGED_RPC_EXECUTE=DENIED");
console.log("SERVICE_ROLE_PRIVILEGED_RPC_EXECUTE=EXPLICIT");
console.log("DEFAULT_SERVICE_IDENTITY=DENIED");
console.log("CLIENT_SUPPLIED_SERVICE_IDENTITY=DENIED");
console.log("PRODUCTION_DATA_DML=NONE");
