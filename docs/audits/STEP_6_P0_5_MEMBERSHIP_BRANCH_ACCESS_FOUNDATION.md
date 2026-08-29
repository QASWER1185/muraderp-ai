# STEP 6 — P0-5 Membership / Branch Access Foundation

## Decision

Authorization is organization-first and fail-closed. An active organization membership establishes organization membership only; it never implies access to any branch. Branch authority requires a separate active grant for the exact branch inside the exact organization.

## Canonical rules

- Organization membership remains keyed by `(organization_id, user_id)` and uses Phase 10 roles/status.
- Branch access remains separate in `branch_access_grants` from the P0-4 branch foundation.
- A null or missing branch context is never wildcard authority.
- No default organization, synthetic branch, implicit branch access, name-based authorization, timestamp-based authorization, or ownership guessing is permitted.
- Missing/invalid tenant context, inactive membership, missing permission, missing branch grant, cross-organization branch relationship, inactive branch, and authorization lookup failure all deny access.

## Repository implementation

- `backend/src/auth/tenant-access.types.ts` defines branch-independent tenant context and an explicit organization-vs-branch authorization scope.
- `backend/src/auth/tenant-access.service.ts` enforces explicit organization membership, permission, and branch-grant checks.
- `backend/src/auth/supabase-authorization.gateway.ts` uses service-only RPCs for membership, permission, and branch checks.
- `backend/src/auth/phase21-org-context.ts` remains a compatibility boundary but no longer treats null branch as organization-wide wildcard branch authority.
- `supabase/migrations/20260829062845_p0_5_membership_branch_access_foundation.sql` adds forward-only service RPCs and least-privilege table/function hardening. It performs no business-data DML and is not applied to production in P0-5.
- The pending migration replaces the recursive/broad Phase 10 membership SELECT policy with an authenticated self-membership read policy; membership administration remains backend-managed.
- `scripts/validate-p0-5-authorization-foundation.mjs` fail-closes if core P0-5 invariants are removed.
- Stage 11 release readiness invokes the P0-5 validator.

## Database authorization boundary

The service-only RPCs are `SECURITY INVOKER`, use an empty search path, and are executable only by `service_role`:

- `is_organization_member_for_user(user, organization)`
- `has_permission_for_user(user, organization, permission)`
- `has_branch_access_for_user(user, organization, branch)`

`has_branch_access_for_user` requires all of:

1. active Phase 10 membership in the requested organization;
2. active explicit branch grant for the requested user/organization/branch;
3. branch identity belonging to that same organization;
4. active branch lifecycle state.

The migration does not add `branch_id` to organization membership and does not create or assign any user, organization, membership, branch, grant, or ownership value.

## RLS / privilege hardening

The pending migration does not weaken RLS. It removes anonymous table access to Phase 10 identity/permission tables, removes authenticated write privileges, preserves authenticated reads behind RLS, and rewrites the membership SELECT policy so authenticated users can read only their own membership rows. Organization administration remains behind the trusted backend/service boundary. P0-4 branch tables remain browser-fail-closed with no authenticated access policy.

## Validation

Deterministic targeted authorization validation covers:

1. active organization member allowed;
2. non-member denied;
3. explicit branch grant allowed;
4. missing branch grant denied;
5. cross-organization request denied;
6. null/absent branch context denied;
7. invalid organization/branch relationship denied;
8. unauthorized permission denied;
9. missing tenant context denied.

The P0-5 repository validator also has negative controls proving it rejects `SECURITY DEFINER`, null-branch guard removal, and recreation of the deprecated recursive membership policy.

The P0-1R execution-environment blocker remains separate. P0-5 does not claim authoritative migration replay or full GitHub CI while runners remain unavailable.
