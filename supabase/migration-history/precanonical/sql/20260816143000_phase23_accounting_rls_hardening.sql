-- Phase 23: accounting security hardening
--
-- These tables are authoritative accounting storage and are intentionally
-- accessed through the protected backend/accounting function boundary.
-- Do not add broad authenticated CRUD policies here: that would create a
-- second authorization path and could bypass organization/RBAC enforcement.
--
-- RLS is enabled as defense-in-depth. service_role/backend operations retain
-- their existing authoritative path because service_role bypasses RLS.

alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;

-- Explicitly keep the Data API roles from gaining a direct table path.
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_lines from anon, authenticated;

-- No authenticated/anon policies are intentionally created on these tables.
-- Authorization remains in the backend/accounting function boundary.
