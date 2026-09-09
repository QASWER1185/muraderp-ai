-- Products final gate: forward-only tenant ownership and integration hardening.
-- Existing unowned rows remain untouched and inaccessible until an approved
-- ownership reconciliation assigns them. NOT VALID constraints still protect
-- every new or subsequently updated row.

alter table public.brands add column if not exists organization_id uuid;
alter table public.rate_lists add column if not exists organization_id uuid;

alter table public.brands
  add constraint brands_products_gate_organization_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.rate_lists
  add constraint rate_lists_products_gate_organization_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;

alter table public.brands
  add constraint brands_products_gate_organization_required
  check (organization_id is not null) not valid;
alter table public.products
  add constraint products_products_gate_organization_required
  check (organization_id is not null) not valid;
alter table public.warehouses
  add constraint warehouses_products_gate_organization_required
  check (organization_id is not null) not valid;
alter table public.inventory
  add constraint inventory_products_gate_organization_required
  check (organization_id is not null) not valid;
alter table public.stock_movements
  add constraint stock_movements_products_gate_scope_required
  check (organization_id is not null) not valid;
alter table public.rate_lists
  add constraint rate_lists_products_gate_organization_required
  check (organization_id is not null) not valid;
alter table public.estimates
  add constraint estimates_products_gate_organization_required
  check (organization_id is not null) not valid;

-- Tenant-scoped business identifiers replace global uniqueness without
-- rewriting or assigning any historical row.
alter table public.products drop constraint if exists products_sku_key;
drop index if exists public.products_sku_key;
create unique index products_products_gate_scoped_sku_key
  on public.products(organization_id, sku)
  where organization_id is not null;
create unique index products_products_gate_legacy_sku_key
  on public.products(sku)
  where organization_id is null;

drop index if exists public.brands_name_unique_idx;
create unique index brands_products_gate_scoped_name_key
  on public.brands(organization_id, lower(btrim(name)))
  where organization_id is not null;
create unique index brands_products_gate_legacy_name_key
  on public.brands(lower(btrim(name)))
  where organization_id is null;

drop index if exists public.rate_lists_code_unique_idx;
create unique index rate_lists_products_gate_scoped_code_key
  on public.rate_lists(organization_id, lower(btrim(code)))
  where organization_id is not null;
create unique index rate_lists_products_gate_legacy_code_key
  on public.rate_lists(lower(btrim(code)))
  where organization_id is null;

alter table public.estimates drop constraint if exists estimates_number_unique;
drop index if exists public.estimates_number_unique;
create unique index estimates_products_gate_scoped_number_key
  on public.estimates(organization_id, estimate_number)
  where organization_id is not null;
create unique index estimates_products_gate_legacy_number_key
  on public.estimates(estimate_number)
  where organization_id is null;

-- Composite ownership keys let child references prove that the referenced
-- Product, Brand, Warehouse, Customer, or Vendor belongs to the same tenant.
create unique index brands_products_gate_organization_id_key
  on public.brands(organization_id, id);
create unique index products_products_gate_organization_id_key
  on public.products(organization_id, id);
create unique index warehouses_products_gate_organization_id_key
  on public.warehouses(organization_id, id);
create unique index customers_products_gate_organization_id_key
  on public.customers(organization_id, id);
create unique index vendors_products_gate_organization_id_key
  on public.vendors(organization_id, id);
create unique index rate_lists_products_gate_organization_id_key
  on public.rate_lists(organization_id, id);

alter table public.products
  add constraint products_products_gate_brand_ownership_fkey
  foreign key (organization_id, brand_id)
  references public.brands(organization_id, id)
  on delete restrict not valid;
alter table public.inventory
  add constraint inventory_products_gate_product_ownership_fkey
  foreign key (organization_id, product_id)
  references public.products(organization_id, id)
  on delete restrict not valid;
alter table public.inventory
  add constraint inventory_products_gate_warehouse_ownership_fkey
  foreign key (organization_id, warehouse_id)
  references public.warehouses(organization_id, id)
  on delete restrict not valid;
alter table public.stock_movements
  add constraint stock_movements_products_gate_product_ownership_fkey
  foreign key (organization_id, product_id)
  references public.products(organization_id, id)
  on delete restrict not valid;
alter table public.stock_movements
  add constraint stock_movements_products_gate_warehouse_ownership_fkey
  foreign key (organization_id, warehouse_id)
  references public.warehouses(organization_id, id)
  on delete restrict not valid;
alter table public.rate_lists
  add constraint rate_lists_products_gate_vendor_ownership_fkey
  foreign key (organization_id, vendor_id)
  references public.vendors(organization_id, id)
  on delete restrict not valid;
alter table public.rate_lists
  add constraint rate_lists_products_gate_customer_ownership_fkey
  foreign key (organization_id, customer_id)
  references public.customers(organization_id, id)
  on delete restrict not valid;
alter table public.estimates
  add constraint estimates_products_gate_customer_ownership_fkey
  foreign key (organization_id, customer_id)
  references public.customers(organization_id, id)
  on delete restrict not valid;

create or replace function private.enforce_products_gate_organization_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.organization_id is not null
     and new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '23514',
      message = 'organization ownership is immutable once assigned';
  end if;
  return new;
end;
$$;

drop trigger if exists brands_products_gate_organization_immutable on public.brands;
create trigger brands_products_gate_organization_immutable
before update of organization_id on public.brands
for each row execute function private.enforce_products_gate_organization_immutable();
drop trigger if exists products_products_gate_organization_immutable on public.products;
create trigger products_products_gate_organization_immutable
before update of organization_id on public.products
for each row execute function private.enforce_products_gate_organization_immutable();
drop trigger if exists warehouses_products_gate_organization_immutable on public.warehouses;
create trigger warehouses_products_gate_organization_immutable
before update of organization_id on public.warehouses
for each row execute function private.enforce_products_gate_organization_immutable();
drop trigger if exists rate_lists_products_gate_organization_immutable on public.rate_lists;
create trigger rate_lists_products_gate_organization_immutable
before update of organization_id on public.rate_lists
for each row execute function private.enforce_products_gate_organization_immutable();
drop trigger if exists estimates_products_gate_organization_immutable on public.estimates;
create trigger estimates_products_gate_organization_immutable
before update of organization_id on public.estimates
for each row execute function private.enforce_products_gate_organization_immutable();

-- Rate items may only map a Product into a rate list owned by that Product's
-- organization. This is the deterministic database boundary behind pricing.
create or replace function private.enforce_rate_list_item_product_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rate_list_organization uuid;
  v_product_organization uuid;
begin
  select rl.organization_id
    into v_rate_list_organization
  from public.rate_list_versions rlv
  join public.rate_lists rl on rl.id = rlv.rate_list_id
  where rlv.id = new.rate_list_version_id;

  select p.organization_id
    into v_product_organization
  from public.products p
  where p.id = new.product_id;

  if v_rate_list_organization is null
     or v_product_organization is null
     or v_rate_list_organization is distinct from v_product_organization then
    raise exception using errcode = '42501',
      message = 'rate-list item Product is outside the rate-list organization';
  end if;
  return new;
end;
$$;

drop trigger if exists rate_list_items_products_gate_ownership on public.rate_list_items;
create trigger rate_list_items_products_gate_ownership
before insert or update of rate_list_version_id, product_id on public.rate_list_items
for each row execute function private.enforce_rate_list_item_product_ownership();

-- Estimate lines preserve the authoritative Product identity and may only use
-- Product/rate-list records from the estimate's organization.
create or replace function private.enforce_estimate_item_product_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estimate_organization uuid;
  v_rate_list_organization uuid;
begin
  select e.organization_id into v_estimate_organization
  from public.estimates e where e.id = new.estimate_id;

  if v_estimate_organization is null
     or not exists (
       select 1 from public.products p
       where p.id = new.product_id
         and p.organization_id = v_estimate_organization
     ) then
    raise exception using errcode = '42501',
      message = 'estimate item Product is outside the estimate organization';
  end if;

  if new.rate_list_id is not null then
    select rl.organization_id into v_rate_list_organization
    from public.rate_lists rl where rl.id = new.rate_list_id;
    if v_rate_list_organization is distinct from v_estimate_organization then
      raise exception using errcode = '42501',
        message = 'estimate item rate list is outside the estimate organization';
    end if;
  end if;

  if new.rate_list_version_id is not null then
    select rl.organization_id into v_rate_list_organization
    from public.rate_list_versions rlv
    join public.rate_lists rl on rl.id = rlv.rate_list_id
    where rlv.id = new.rate_list_version_id
      and (new.rate_list_id is null or rl.id = new.rate_list_id);
    if v_rate_list_organization is distinct from v_estimate_organization then
      raise exception using errcode = '42501',
        message = 'estimate item rate-list version is outside the estimate organization';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists estimate_items_products_gate_ownership on public.estimate_items;
create trigger estimate_items_products_gate_ownership
before insert or update of estimate_id, product_id, rate_list_id, rate_list_version_id
on public.estimate_items
for each row execute function private.enforce_estimate_item_product_ownership();

revoke all on function private.enforce_products_gate_organization_immutable()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_rate_list_item_product_ownership()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_estimate_item_product_ownership()
  from public, anon, authenticated, service_role;

-- The Phase 20 adjustment RPC changes stock without tenant/branch checks or an
-- authoritative accounting/costing path. Disable it until a complete inventory
-- adjustment transaction engine is introduced; AI remains proposal-only.
revoke all on function public.record_inventory_adjustment(
  bigint, bigint, numeric, text, text, text, text
) from public, anon, authenticated, service_role;

comment on constraint products_products_gate_organization_required on public.products is
  'Products final gate: all new/updated Products require authoritative organization ownership; legacy unowned rows require separate reconciliation.';
comment on function private.enforce_rate_list_item_product_ownership() is
  'Products final gate: prevents cross-organization Product mappings in dynamic rate lists.';
