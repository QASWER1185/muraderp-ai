# MuradERP-AI - STEP 6 P0-2 Phase 21 Disposition

Date: 2026-08-28
Status: RESOLVED - REPOSITORY-ONLY CONTROLLED UNIT
Database mutation: NONE
Migration application: NONE

## Scope

P0-2 resolves the four historical Phase 21 organization/branch migrations that P0-1 deliberately left in `PENDING_P0_2_REVIEW` state. This unit classifies them only. It does not apply SQL, change Supabase, backfill ownership, enable RLS, or add a new tenant-isolation migration.

The P0-1 evidence bundle remains immutable. The P0-2 decision is recorded separately in `supabase/migration-provenance/phase21-disposition.json` and is cryptographically bound to the approved P0-1 evidence fingerprint.

## Canonical evidence

- Canonical identity/organization foundation: `20260815070000_phase_10_identity_organization_authorization.sql`.
- Accepted authorization ADR: `docs/adr/ADR-014-identity-organization-authorization.md`.
- P0-1 provenance evidence: `supabase/migration-provenance/live-applied.json`.
- Historical Phase 21 migrations:
  - `20260815190000_phase21_organization_branch_security.sql`
  - `20260815190100_phase21_branch_key_guard.sql`
  - `20260815190200_phase21_branch_reference_fix.sql`
  - `20260815190300_phase21_schema_validation.sql`
- Runtime compatibility evidence: `backend/src/auth/phase21-org-context.ts` and its Phase 21/23 regression tests.

## Disposition

| File | P0-2 disposition | Apply? |
| --- | --- | --- |
| `20260815190000_phase21_organization_branch_security.sql` | `SUPERSEDED_DESIGN_REFERENCE` | NO |
| `20260815190100_phase21_branch_key_guard.sql` | `REDUNDANT_HISTORICAL_CORRECTION` | NO |
| `20260815190200_phase21_branch_reference_fix.sql` | `REDUNDANT_HISTORICAL_CORRECTION` | NO |
| `20260815190300_phase21_schema_validation.sql` | `REDUNDANT_HISTORICAL_CORRECTION` | NO |

Overall decision: `HISTORICAL_ONLY_DO_NOT_APPLY`.

The files remain in place, byte-for-byte immutable, because P0-1 captured them as historical repository evidence. Their presence is not authorization to execute them. Direct `supabase db push` remains blocked until the historical migration chain is explicitly reconciled.

## Why the primary Phase 21 migration is not canonical

The primary Phase 21 migration conflicts with the accepted tenant-isolation model in security-significant ways:

1. It recreates `organizations` and `organization_memberships` even though Phase 10 already owns the identity/organization foundation.
2. It embeds `branch_id` inside membership rows and treats a null branch as organization-wide branch access. The approved tenant model requires organization-wide membership plus explicit branch grants, without null-as-wildcard authorization semantics.
3. It uses uppercase generic roles (`OWNER`, `ADMIN`, `MANAGER`, `STAFF`, `VIEWER`) and `is_active`, while the canonical Phase 10 contract uses lowercase domain roles and a `status` lifecycle.
4. It adds tenant columns and branch constraints broadly before legacy ownership is proven/backfilled. That violates the accepted ownership gate: no existing row may be silently assigned to an organization.
5. It covers only a subset of tenant-owned ERP tables and therefore cannot serve as the production tenant-isolation foundation.
6. Its branch composite-key requirement was missing in the primary migration and then corrected three times by follow-up migrations. A future canonical branch migration must be internally ordered and complete from the start.

## Concepts that may be preserved, but not copied blindly

The following Phase 21 ideas remain useful design evidence:

- a first-class `branches` entity owned by an organization;
- an organization-qualified branch key such as `(id, organization_id)` for cross-tenant FK safety;
- organization/branch indexes where query shape requires them;
- an authenticated server-side organization/branch request context.

These concepts must be reimplemented under the approved Phase 10 + Step 5 contracts, not by applying the historical Phase 21 SQL.

## Runtime compatibility disposition

`backend/src/auth/phase21-org-context.ts` is retained unchanged in P0-2 to avoid mixing migration-history reconciliation with a broad runtime authorization rewrite. It is classified as a temporary compatibility boundary only.

Its current null-branch behavior is deprecated for the tenant-isolation foundation. Before branch enforcement is promoted to production authority, branch authorization must be derived from explicit organization membership and explicit branch grants. A null `branchId` must not itself grant wildcard access to every branch.

Existing Phase 21/23 tests that encode null-branch organization-wide behavior are historical regression evidence; they do not supersede the accepted Step 5 tenant-isolation architecture.

## Migration-chain status after P0-2

P0-2 resolves only `P0_2_PHASE21_DISPOSITION_REQUIRED` as a current decision blocker. The active migration chain is still NOT deployable because the immutable P0-1 capture records additional unresolved blockers:

- `REMOTE_AND_REPOSITORY_VERSION_SETS_DIVERGE`
- `HISTORICAL_DUPLICATE_REPOSITORY_VERSIONS`

Therefore:

- no direct `supabase db push`;
- no `supabase migration repair`;
- no Phase 21 migration application;
- no tenant ownership backfill;
- no RLS activation from these historical files.

## P0-2 acceptance result

- Phase 21 historical SQL classified: PASS
- Phase 10 identity foundation preserved: PASS
- P0-1 evidence left immutable: PASS
- Historical file fingerprints bound into P0-2 manifest: PASS
- Historical SQL execution authorization: DENIED
- Live DB changes: NONE
- New migration: NONE
- Active chain deployable: NO

## Next controlled unit

Prepare the canonical tenant-isolation foundation from the Phase 10 identity contract and the accepted Step 5 model, using only new forward-only migration versions greater than `20260824170000`. Ownership/backfill remains blocked until authoritative ownership data exists. No future unit may treat P0-2 as authorization to guess ownership or apply the historical Phase 21 chain.
