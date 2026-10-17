-- MuradERP-AI Pricing / Rate List foundation.
--
-- This migration establishes the canonical pricing model used by purchases,
-- sales, estimates, quotations, invoices, OCR imports and future AI price
-- resolution. It intentionally does not mutate existing product prices.

create table if not exists public.rate_lists (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  code text not null check (btrim(code) <> ''),
  price_type text not null check (price_type in ('PURCHASE', 'SALE')),
  scope_type text not null check (scope_type in ('GLOBAL', 'VENDOR', 'CUSTOMER')),
  vendor_id bigint references public.vendors (id),
  customer_id bigint references public.customers (id),
  currency_code text not null default 'PKR' check (btrim(currency_code) <> '' and length(currency_code) <= 10),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_lists_scope_owner_check check (
    (scope_type = 'GLOBAL' and vendor_id is null and customer_id is null)
    or
    (scope_type = 'VENDOR' and vendor_id is not null and customer_id is null)
    or
    (scope_type = 'CUSTOMER' and customer_id is not null and vendor_id is null)
  )
);

create unique index if not exists rate_lists_code_unique_idx
  on public.rate_lists (lower(btrim(code)));

create index if not exists rate_lists_vendor_idx
  on public.rate_lists (vendor_id)
  where vendor_id is not null;

create index if not exists rate_lists_customer_idx
  on public.rate_lists (customer_id)
  where customer_id is not null;

create table if not exists public.rate_list_versions (
  id bigint generated always as identity primary key,
  rate_list_id bigint not null references public.rate_lists (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_list_versions_dates_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint rate_list_versions_unique_number unique (rate_list_id, version_number)
);

create unique index if not exists rate_list_versions_active_unique_idx
  on public.rate_list_versions (rate_list_id)
  where status = 'ACTIVE';

create index if not exists rate_list_versions_resolution_idx
  on public.rate_list_versions (rate_list_id, effective_from desc);

create table if not exists public.rate_list_items (
  id bigint generated always as identity primary key,
  rate_list_version_id bigint not null references public.rate_list_versions (id) on delete cascade,
  product_id bigint not null references public.products (id),
  minimum_quantity numeric not null default 1 check (minimum_quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  unit text not null check (btrim(unit) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_list_items_product_tier_unique
    unique (rate_list_version_id, product_id, minimum_quantity)
);

create index if not exists rate_list_items_product_idx
  on public.rate_list_items (product_id);

create index if not exists rate_list_items_version_product_idx
  on public.rate_list_items (rate_list_version_id, product_id, minimum_quantity desc);

-- Pricing data is backend-controlled. Browser-facing roles must not mutate or
-- read rate-list internals directly; application services own price resolution.
alter table public.rate_lists enable row level security;
alter table public.rate_lists force row level security;
alter table public.rate_list_versions enable row level security;
alter table public.rate_list_versions force row level security;
alter table public.rate_list_items enable row level security;
alter table public.rate_list_items force row level security;

drop policy if exists backend_only on public.rate_lists;
create policy backend_only on public.rate_lists
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.rate_list_versions;
create policy backend_only on public.rate_list_versions
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.rate_list_items;
create policy backend_only on public.rate_list_items
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.rate_lists from anon, authenticated;
revoke all on table public.rate_list_versions from anon, authenticated;
revoke all on table public.rate_list_items from anon, authenticated;

grant select, insert, update, delete on table public.rate_lists to service_role;
grant select, insert, update, delete on table public.rate_list_versions to service_role;
grant select, insert, update, delete on table public.rate_list_items to service_role;

grant usage, select on sequence public.rate_lists_id_seq to service_role;
grant usage, select on sequence public.rate_list_versions_id_seq to service_role;
grant usage, select on sequence public.rate_list_items_id_seq to service_role;
