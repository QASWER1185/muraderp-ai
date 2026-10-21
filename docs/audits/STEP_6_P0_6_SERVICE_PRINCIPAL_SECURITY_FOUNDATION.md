# STEP 6 — P0-6 SERVICE-PRINCIPAL SECURITY FOUNDATION

## Scope

P0-6 establishes the privileged backend/service execution boundary only. It does not apply a migration, change live RLS, create a service-principal table, create credentials, rotate production secrets, create organizations/memberships/branches, backfill ownership, or mutate business data.

Starting baseline: accepted P0-5 commit `880fe671ad93818e1ec46b87ac0fca2a7824bc4e`.

## Existing security architecture

The existing system already has distinct security building blocks and does not require a parallel service-principal database model:

1. Browser identity is established by browser/session authentication and remains subject to the Phase 10/P0-5 organization membership and permission model.
2. The backend HTTP service credential is `INTERNAL_API_TOKEN`.
3. The backend database credential is the server-only Supabase secret/service-role key.
4. P0-5 authorization RPCs are service-role-only and enforce user/organization/branch authorization through the backend.
5. Privileged transaction RPCs are backend-only database operations.

P0-6 adds an explicit stable non-secret audit identity, `INTERNAL_API_PRINCIPAL_ID`, to the HTTP service credential boundary. Credential and identity are deliberately separate: the token/key can rotate without changing the logical audit principal.

## Concrete defects corrected

- `INTERNAL_API_PRINCIPAL_ID` previously defaulted to `internal-system`.
- `createErpRouter` previously had an `internal-system` audit-principal fallback.
- the atomic sales adapter previously had a `backend` audit-principal fallback.
- successful internal-token authentication previously did not attach a trusted service principal to the request.
- the authorization gateway exposed a generic client-construction helper that accepted URL/key arguments.
- historical privileged transaction functions had safe service-role-only grants, but several retained broad `search_path` values and historical default audit scopes such as `internal-system` or `service_role`.

## Service-principal model

No new service-principal table is introduced.

Identity:
- explicit server-configured `INTERNAL_API_PRINCIPAL_ID`;
- non-secret, stable audit identifier;
- generic identities such as `backend`, `default`, `internal-system`, `service_role`, `service-role`, and `system` are rejected.

Credential boundary:
- `INTERNAL_API_TOKEN` authenticates backend HTTP callers;
- Supabase secret/service-role key authenticates the backend database principal;
- neither credential is accepted from application payload fields as a service identity;
- neither credential is exposed to browser clients.

Lifecycle and rotation:
- rotate/revoke the HTTP token independently of the audit identity;
- rotate/revoke the Supabase secret/service-role key independently of the audit identity;
- change the principal ID only when the logical service identity changes;
- no production credential rotation occurs in P0-6.

Organization scope:
- the service principal itself is not fabricated as an organization member;
- where a privileged workflow acts for an ERP user/organization, P0-5 remains the authorization authority;
- AI Copilot continues to enforce user/organization permissions before execution.

Auditability:
- authenticated internal requests receive a frozen server-created `request.servicePrincipal`;
- successful internal service authentication emits the non-secret principal ID to structured server logs;
- transactional RPC contexts continue to carry explicit principal/idempotency scope where the existing contract supports it.

## Database privilege decision

Existing privileged transaction function bodies are not blindly converted between `SECURITY DEFINER` and `SECURITY INVOKER`.

The forward migration preserves those historical bodies by renaming them to P0-6 implementation names, removes direct `service_role` execution on the implementations, fixes their `search_path` to empty, and creates same-signature service-facing wrappers.

The wrappers are intentionally `SECURITY DEFINER` because direct execution of the historical implementations is revoked even from `service_role`. Each wrapper is hardened by:

- explicit `OWNER TO postgres`;
- `SET search_path = ''`;
- schema-qualified calls to `public.*_p0_6_impl`;
- explicit named-principal validation;
- operation validation where the existing RPC carries an operation field;
- `PUBLIC`, `anon`, and `authenticated` execute revocation;
- `service_role` as the only explicit execute grantee.

The migration contains no business-data DML.

## Live read-only privilege evidence

Targeted production catalog inspection confirmed before implementation:

| Function | Volatility | Security mode | Live browser execute | Live service_role execute |
| --- | --- | --- | --- | --- |
| `record_purchase` | VOLATILE | DEFINER | no | yes |
| `record_customer_payment` | VOLATILE | DEFINER | no | yes |
| `record_vendor_payment` | VOLATILE | INVOKER | no | yes |
| `record_sales_return` | VOLATILE | DEFINER | no | yes |
| `post_invoice_atomic` | VOLATILE | DEFINER | no | yes |
| `has_permission_for_user` | STABLE | DEFINER (live historical state) | no | yes |

The accepted, pending P0-5 migration already replaces the authorization helper with an invoker-rights service-only model and revokes browser execution from P0-5 service RPCs. P0-6 does not duplicate that accepted work.

Production schema privileges also confirmed that `anon` and `authenticated` have no `CREATE` privilege in `public`, and no `USAGE`/`CREATE` privilege in `private`.

## P0-6 migration

`supabase/migrations/20260829065058_p0_6_service_principal_security_foundation.sql`

The version is newer than both `20260824170000` and P0-5 `20260829062845`.

It is repository-only in this unit and MUST NOT be applied to production until the migration-provenance/integration blocker is resolved and deployment is separately authorized.

## Validation

Available local validation:

- targeted TypeScript check for service-principal/config/gateway/middleware code: PASS;
- targeted TypeScript check for the atomic sales adapter: PASS;
- deterministic service/tenant fail-closed harness: 6/6 PASS;
- P0-6 static security validator: PASS;
- validator negative control — browser execute grant: expected FAIL;
- validator negative control — default `internal-system` identity: expected FAIL;
- validator negative control — removed database principal guard: expected FAIL;
- Node syntax checks for release/security validators: PASS.

The P0-6 validator enforces:

- no PUBLIC/anon/authenticated execute grants for privileged RPCs;
- exactly service-role execution grants on hardened service-facing RPCs;
- five fixed-empty-path historical implementations and five fixed-empty-path wrappers;
- explicit postgres owner on all five SECURITY DEFINER wrappers;
- explicit named service principal on all five wrappers;
- operation checks for purchase, customer payment, and sales return;
- no default service identity in backend config;
- no client-supplied service-principal header path;
- central service-role Supabase client usage;
- P0-5 service-only authorization grants remain intact;
- no business-data DML in the P0-6 migration.

Full repository CI and actual migration execution are not claimed. The current environment has no Supabase CLI/PostgreSQL runtime, production is read-only by architect instruction, and GitHub runner allocation remains a parallel infrastructure blocker.

## Nonblocking finding

**P1 — sales RPC integration mismatch:** `SupabaseSalesTransactionRepository` calls `record_sales_transaction`, while targeted live production catalog inspection found no live RPC with that name. This is not repaired in P0-6 because it is a sales transaction integration issue rather than a service-principal security-boundary defect. It must be resolved before production activation of that sales route.

## Production safety

Production database mutation in P0-6: **ZERO**.

No migration apply, RLS modification, credential creation/rotation, service-principal creation, data mutation, ownership backfill, deployment, reset, repair, or clean replay is authorized or performed.
