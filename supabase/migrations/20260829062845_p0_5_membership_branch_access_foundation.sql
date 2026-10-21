-- STEP 6 P0-5: Membership / Branch Access Foundation
-- Forward-only authorization hardening. No rows are created, updated, deleted,
-- backfilled, or assigned to an organization/branch by this migration.

-- Fail fast if canonical Phase 10 and P0-4 foundations are not present.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.role_permissions') is null then
    raise exception 'P0-5 requires canonical Phase 10 organization authorization foundation';
  end if;

  if to_regclass('public.branches') is null
     or to_regclass('public.branch_access_grants') is null then
    raise exception 'P0-5 requires P0-4 branch foundation';
  end if;
end
$$;

-- Defense in depth: browser-facing roles must not retain default write grants on
-- identity/authorization tables. Existing RLS SELECT policies remain in force.
revoke all on table public.organizations from anon;
revoke all on table public.organization_memberships from anon;
revoke all on table public.permissions from anon;
revoke all on table public.role_permissions from anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.organizations,
           public.organization_memberships,
           public.permissions,
           public.role_permissions
  from authenticated;

grant select on table public.organizations,
                      public.organization_memberships,
                      public.permissions,
                      public.role_permissions
  to authenticated;

-- Service-only organization membership check. SECURITY INVOKER is deliberate:
-- service_role already has the trusted backend privilege boundary and RLS bypass;
-- the function itself does not add privilege.
create or replace function public.is_organization_member_for_user(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_user_id is not null
    and p_organization_id is not null
    and exists (
      select 1
      from public.organization_memberships om
      where om.user_id = p_user_id
        and om.organization_id = p_organization_id
        and om.status = 'active'
    );
$$;

-- Replace the historical service helper with an invoker-rights implementation.
-- Organization membership and role permission must both be active/matching.
create or replace function public.has_permission_for_user(
  p_user_id uuid,
  p_organization_id uuid,
  p_permission_code text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_user_id is not null
    and p_organization_id is not null
    and nullif(btrim(p_permission_code), '') is not null
    and exists (
      select 1
      from public.organization_memberships om
      join public.role_permissions rp on rp.role = om.role
      where om.user_id = p_user_id
        and om.organization_id = p_organization_id
        and om.status = 'active'
        and rp.permission_code = p_permission_code
    );
$$;

-- Branch authority is separate from organization membership. It requires:
--   1) active membership in the same organization,
--   2) an active explicit grant for the exact branch,
--   3) the branch to belong to that same organization and be active.
-- A NULL branch never expands access.
create or replace function public.has_branch_access_for_user(
  p_user_id uuid,
  p_organization_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p_user_id is not null
    and p_organization_id is not null
    and p_branch_id is not null
    and exists (
      select 1
      from public.organization_memberships om
      join public.branch_access_grants bag
        on bag.organization_id = om.organization_id
       and bag.user_id = om.user_id
      join public.branches b
        on b.organization_id = bag.organization_id
       and b.id = bag.branch_id
      where om.user_id = p_user_id
        and om.organization_id = p_organization_id
        and om.status = 'active'
        and bag.branch_id = p_branch_id
        and bag.status = 'active'
        and b.status = 'active'
    );
$$;

-- Service-only RPC boundary. The browser cannot invoke user-parameterized
-- authorization helpers to probe another user's access.
revoke all on function public.is_organization_member_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function public.has_permission_for_user(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.has_branch_access_for_user(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.is_organization_member_for_user(uuid, uuid) to service_role;
grant execute on function public.has_permission_for_user(uuid, uuid, text) to service_role;
grant execute on function public.has_branch_access_for_user(uuid, uuid, uuid) to service_role;

-- User-context helpers remain authenticated-only; anonymous execution is not
-- required and is removed explicitly.
revoke all on function public.current_user_organizations() from public, anon;
revoke all on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.current_user_organizations() to authenticated;
grant execute on function public.has_permission(uuid, text) to authenticated;

comment on function public.is_organization_member_for_user(uuid, uuid) is
  'P0-5 service-only active organization membership check; organization membership is branch-independent.';
comment on function public.has_permission_for_user(uuid, uuid, text) is
  'P0-5 service-only organization permission check using active Phase 10 membership and role permissions.';
comment on function public.has_branch_access_for_user(uuid, uuid, uuid) is
  'P0-5 service-only explicit branch-grant check; NULL branch is never wildcard access.';

-- Replace broad/recursive Phase 10 SELECT policies with explicit authenticated,
-- fail-closed read policies. Organization-member administration stays behind
-- the trusted backend service boundary; browser users may inspect only their
-- own membership rows.
drop policy if exists memberships_select_self_or_same_org on public.organization_memberships;
create policy memberships_select_self on public.organization_memberships
for select
to authenticated
using (
  (select auth.uid()) is not null
  and user_id = (select auth.uid())
);

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = organizations.id
      and om.user_id = (select auth.uid())
      and om.status = 'active'
  )
);

drop policy if exists permissions_select_authenticated on public.permissions;
create policy permissions_select_authenticated on public.permissions
for select
to authenticated
using ((select auth.uid()) is not null);

drop policy if exists role_permissions_select_authenticated on public.role_permissions;
create policy role_permissions_select_authenticated on public.role_permissions
for select
to authenticated
using ((select auth.uid()) is not null);
