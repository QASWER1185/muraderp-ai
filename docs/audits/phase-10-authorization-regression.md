# Phase 10 Authorization Regression Contract

This audit contract protects the Phase 10 security boundary without creating unsafe tenant reassignment.

## Required invariants
- A caller without the requested permission is denied with HTTP 403 by the backend authorization service.
- Authorization is evaluated in the authenticated organization context.
- Missing organization context is rejected before organization-scoped ERP work.
- A branch outside the active organization context is rejected.
- Existing ERP services remain the authoritative mutation boundary.
- Legacy ERP rows are never silently assigned to an organization by an audit migration.

## Verification basis
The Phase 10 authorization service, Supabase authorization gateway, and later organization-context boundary are the authoritative implementation surfaces. CI remains responsible for executing the repository's full regression, typecheck, build, security, and release gates.
