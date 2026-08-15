# ADR-014 — Identity, Organization Isolation, and Role-Based Authorization

## Status
Accepted

## Decision

MuradERP-AI is multi-organization by design. Supabase Auth provides the authenticated identity; organization membership, roles, and permissions are stored in application tables. Backend business services remain the authoritative mutation boundary.

Authorization is enforced in three layers: authenticated session context, backend service permission checks, and Supabase RLS/database policies as defense in depth.

AI, OCR, camera, and voice inputs never receive direct database mutation authority. They operate in the authenticated organization context and produce validated drafts/commands consumed by existing business services.

## Roles

owner, admin, manager, accountant, sales, purchase, inventory, viewer.

## Permission model

Permissions are explicit capability codes such as `purchases.create`, `accounting.post`, and `organization.manage`. This allows backend, frontend, and future AI clients to share one authorization vocabulary.

## Migration strategy

Phase 10 establishes identity/membership/permission primitives first. Existing transactional tables are not silently assigned to an organization. Each legacy domain will receive an explicit compatibility/backfill migration before organization-scoped RLS enforcement is enabled for that domain.

## Security boundary

Frontend-only authorization is never sufficient. Sensitive operations must be rejected server-side when the caller lacks organization membership or the required permission.
