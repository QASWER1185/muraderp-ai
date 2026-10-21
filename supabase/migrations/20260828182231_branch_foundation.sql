-- STEP 6 P0-4: Branch Foundation
--
-- Controlled, additive tenant-isolation foundation.
-- This migration creates schema only. It does not create organizations,
-- branches, memberships, users, ownership assignments, or legacy backfills.
-- Existing business, inventory, stock-movement, and accounting rows remain
-- untouched and unowned until a separately approved controlled unit.

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  code text not null,
  name text not null,
  status text not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint branches_organization_id_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,

  constraint branches_code_check
    check (length(btrim(code)) between 1 and 64),

  constraint branches_name_check
    check (length(btrim(name)) between 2 and 200),

  constraint branches_status_check
    check (status in ('active', 'inactive', 'archived')),

  constraint branches_archive_state_check
    check (
      (status = 'archived' and archived_at is not null)
      or
      (status <> 'archived' and archived_at is null)
    ),

  -- Allows child tables to prove that a branch belongs to the same
  -- organization without relying on branch_id alone.
  constraint branches_organization_id_id_key
    unique (organization_id, id)
);

-- Branch code and branch name are unique only inside an organization.
-- Case/outer-whitespace differences do not create a second logical branch.
create unique index branches_organization_code_unique_idx
  on public.branches (organization_id, lower(btrim(code)));

create unique index branches_organization_name_unique_idx
  on public.branches (organization_id, lower(btrim(name)));

create index branches_organization_status_idx
  on public.branches (organization_id, status);

-- Organization membership remains organization-wide. Branch access is modeled
-- separately and explicitly; a null branch is never interpreted as wildcard
-- access to every branch.
create table public.branch_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null,
  status text not null default 'active',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint branch_access_grants_status_check
    check (status in ('active', 'revoked')),

  constraint branch_access_grants_revocation_state_check
    check (
      (status = 'revoked' and revoked_at is not null)
      or
      (status = 'active' and revoked_at is null)
    ),

  -- The branch and grant must belong to the same organization.
  constraint branch_access_grants_branch_organization_fkey
    foreign key (organization_id, branch_id)
    references public.branches(organization_id, id)
    on delete restrict,

  -- A branch grant can exist only for a user who already has an organization-
  -- wide membership in the same organization. This uses the canonical Phase 10
  -- unique (organization_id, user_id) membership key and does not alter the
  -- organization_memberships model.
  constraint branch_access_grants_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,

  constraint branch_access_grants_organization_branch_user_key
    unique (organization_id, branch_id, user_id)
);

create index branch_access_grants_user_status_idx
  on public.branch_access_grants (user_id, status);

create index branch_access_grants_organization_branch_status_idx
  on public.branch_access_grants (organization_id, branch_id, status);

-- Branch organization ownership is immutable and archive is terminal. Branch
-- rows are preserved instead of being destructively deleted.
create or replace function private.enforce_branch_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'branch organization ownership is immutable'
      using errcode = '23514';
  end if;

  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'archived branches cannot be reactivated'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.reject_branch_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'branches must be archived, not deleted'
    using errcode = '23514';
end;
$$;

-- Grant identity is immutable. Access is revoked through lifecycle state rather
-- than re-pointing an existing grant to another organization, branch, or user.
create or replace function private.enforce_branch_access_grant_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.user_id is distinct from old.user_id then
    raise exception 'branch access grant identity is immutable'
      using errcode = '23514';
  end if;

  if old.status = 'revoked' and new.status <> 'revoked' then
    raise exception 'revoked branch access grants cannot be reactivated'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger branches_update_guard
before update on public.branches
for each row
execute function private.enforce_branch_update_guard();

create trigger branches_delete_guard
before delete on public.branches
for each row
execute function private.reject_branch_delete();

create trigger branch_access_grants_update_guard
before update on public.branch_access_grants
for each row
execute function private.enforce_branch_access_grant_update_guard();

-- These tables are in the exposed public schema, so RLS is enabled immediately.
-- P0-4 intentionally creates no authenticated policies: runtime branch
-- authorization is a later controlled unit. Until then, browser-facing roles
-- cannot read or mutate this foundation.
alter table public.branches enable row level security;
alter table public.branch_access_grants enable row level security;

revoke all on table public.branches from anon, authenticated;
revoke all on table public.branch_access_grants from anon, authenticated;

-- Trusted backend access is explicit. DELETE is intentionally not granted for
-- branches; archiving is performed with UPDATE.
grant select, insert, update on table public.branches to service_role;
grant select, insert, update on table public.branch_access_grants to service_role;

revoke all on function private.enforce_branch_update_guard() from public, anon, authenticated;
revoke all on function private.reject_branch_delete() from public, anon, authenticated;
revoke all on function private.enforce_branch_access_grant_update_guard() from public, anon, authenticated;

comment on table public.branches is
  'P0-4 branch foundation. Organization ownership is immutable; archive instead of delete.';

comment on table public.branch_access_grants is
  'P0-4 explicit user-to-branch access grants within an existing organization membership.';
