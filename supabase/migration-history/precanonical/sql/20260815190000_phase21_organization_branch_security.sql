-- MuradERP-AI Phase 21: organization / branch security foundation.
-- Safe, additive migration. Existing rows are not deleted or silently reassigned.
-- Legacy rows remain available for controlled backfill before enforcement is enabled.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organizations_name_unique_idx
  on public.organizations (lower(name));

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, code)
);

create index if not exists branches_organization_id_idx
  on public.branches (organization_id);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  role text not null check (role in ('OWNER','ADMIN','MANAGER','STAFF','VIEWER')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id, branch_id),
  constraint membership_branch_belongs_to_org foreign key (branch_id, organization_id)
    references public.branches(id, organization_id)
    on delete cascade
);

create unique index if not exists one_org_owner_per_user_idx
  on public.organization_memberships (user_id, organization_id)
  where role = 'OWNER' and is_active;

create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, is_active);

create index if not exists organization_memberships_org_idx
  on public.organization_memberships (organization_id, is_active);

-- Add nullable ownership columns first. Existing data must be explicitly backfilled
-- before NOT NULL/RLS enforcement is introduced in a later controlled migration.
alter table public.brands add column if not exists organization_id uuid references public.organizations(id);
alter table public.customers add column if not exists organization_id uuid references public.organizations(id);
alter table public.vendors add column if not exists organization_id uuid references public.organizations(id);
alter table public.warehouses add column if not exists organization_id uuid references public.organizations(id);
alter table public.products add column if not exists organization_id uuid references public.organizations(id);
alter table public.inventory add column if not exists organization_id uuid references public.organizations(id);
alter table public.purchases add column if not exists organization_id uuid references public.organizations(id);
alter table public.purchase_items add column if not exists organization_id uuid references public.organizations(id);
alter table public.stock_movements add column if not exists organization_id uuid references public.organizations(id);

alter table public.warehouses add column if not exists branch_id uuid;
alter table public.inventory add column if not exists branch_id uuid;
alter table public.purchases add column if not exists branch_id uuid;
alter table public.stock_movements add column if not exists branch_id uuid;

-- Composite foreign keys prevent a branch from being attached to another organization.
alter table public.warehouses
  drop constraint if exists warehouses_branch_organization_fk;
alter table public.warehouses
  add constraint warehouses_branch_organization_fk
  foreign key (branch_id, organization_id)
  references public.branches(id, organization_id)
  on delete restrict;

alter table public.inventory
  drop constraint if exists inventory_branch_organization_fk;
alter table public.inventory
  add constraint inventory_branch_organization_fk
  foreign key (branch_id, organization_id)
  references public.branches(id, organization_id)
  on delete restrict;

alter table public.purchases
  drop constraint if exists purchases_branch_organization_fk;
alter table public.purchases
  add constraint purchases_branch_organization_fk
  foreign key (branch_id, organization_id)
  references public.branches(id, organization_id)
  on delete restrict;

alter table public.stock_movements
  drop constraint if exists stock_movements_branch_organization_fk;
alter table public.stock_movements
  add constraint stock_movements_branch_organization_fk
  foreign key (branch_id, organization_id)
  references public.branches(id, organization_id)
  on delete restrict;

create index if not exists brands_organization_id_idx on public.brands (organization_id);
create index if not exists customers_organization_id_idx on public.customers (organization_id);
create index if not exists vendors_organization_id_idx on public.vendors (organization_id);
create index if not exists warehouses_organization_branch_idx on public.warehouses (organization_id, branch_id);
create index if not exists products_organization_id_idx on public.products (organization_id);
create index if not exists inventory_organization_branch_idx on public.inventory (organization_id, branch_id);
create index if not exists purchases_organization_branch_idx on public.purchases (organization_id, branch_id);
create index if not exists purchase_items_organization_id_idx on public.purchase_items (organization_id);
create index if not exists stock_movements_organization_branch_idx on public.stock_movements (organization_id, branch_id);

-- RLS is enabled now, but policies intentionally allow only authenticated users
-- who have an active membership. Legacy NULL-owned rows remain inaccessible to
-- authenticated API clients until an explicit backfill assigns ownership.
alter table public.organizations enable row level security;
alter table public.branches enable row level security;
alter table public.organization_memberships enable row level security;

create or replace function public.current_user_has_org_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organization_id = target_org
      and m.is_active
  );
$$;

create or replace function public.current_user_has_branch_access(target_org uuid, target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.user_id = auth.uid()
      and m.organization_id = target_org
      and m.is_active
      and (m.branch_id is null or m.branch_id = target_branch)
  );
$$;

revoke all on function public.current_user_has_org_access(uuid) from public;
revoke all on function public.current_user_has_branch_access(uuid, uuid) from public;
grant execute on function public.current_user_has_org_access(uuid) to authenticated;
grant execute on function public.current_user_has_branch_access(uuid, uuid) to authenticated;

create policy organizations_member_select
  on public.organizations for select to authenticated
  using (public.current_user_has_org_access(id));

create policy branches_member_select
  on public.branches for select to authenticated
  using (public.current_user_has_org_access(organization_id));

create policy memberships_self_select
  on public.organization_memberships for select to authenticated
  using (user_id = auth.uid());

-- Keep ownership columns nullable during migration/backfill. Do not enable
-- table-wide ERP RLS until all existing records have an explicit organization
-- and branch assignment; that is a separate controlled cutover step.

comment on table public.organizations is 'Phase 21 tenant root. Existing ERP records require explicit backfill before tenant enforcement.';
comment on table public.branches is 'Phase 21 branch context owned by an organization.';
comment on table public.organization_memberships is 'Phase 21 authenticated user membership and role boundary.';
