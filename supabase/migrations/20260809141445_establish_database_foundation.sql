-- MuradERP-AI database foundation.
--
-- This migration is intentionally safe to apply to the existing MuradERP-AI
-- project. It preserves current rows, makes the schema reproducible, keeps the
-- Data API deny-by-default, and adds one atomic purchase workflow.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists public.brands (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create unique index if not exists brands_name_unique_idx
  on public.brands (lower(name));

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  phone text not null,
  city text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.vendors (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  phone text not null,
  city text not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.warehouses (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  location text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.products (
  id bigint generated always as identity primary key,
  brand_id bigint references public.brands (id),
  name text not null check (btrim(name) <> ''),
  sku text not null unique check (btrim(sku) <> ''),
  category text not null,
  unit text not null,
  purchase_price numeric not null check (purchase_price >= 0),
  sale_price numeric not null check (sale_price >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.inventory (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id),
  warehouse_id bigint not null references public.warehouses (id),
  quantity numeric not null default 0 check (quantity >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint unique_product_warehouse unique (product_id, warehouse_id)
);

create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors (id),
  warehouse_id bigint not null references public.warehouses (id),
  purchase_date date not null default current_date,
  invoice_number text,
  subtotal numeric not null default 0 check (subtotal >= 0),
  discount numeric not null default 0 check (discount >= 0),
  tax numeric not null default 0 check (tax >= 0),
  total numeric not null default 0 check (total >= 0),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.purchase_items (
  id bigint generated always as identity primary key,
  purchase_id bigint not null references public.purchases (id),
  product_id bigint not null references public.products (id),
  quantity numeric not null check (quantity > 0),
  unit_cost numeric not null check (unit_cost >= 0),
  total_cost numeric not null check (total_cost >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint purchase_items_total_cost_matches
    check (total_cost = quantity * unit_cost)
);

create table if not exists public.stock_movements (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id),
  warehouse_id bigint not null references public.warehouses (id),
  movement_type text not null check (
    movement_type in (
      'OPENING',
      'PURCHASE',
      'SALE',
      'PURCHASE_RETURN',
      'SALE_RETURN',
      'ADJUSTMENT',
      'TRANSFER_IN',
      'TRANSFER_OUT'
    )
  ),
  quantity numeric not null check (quantity > 0),
  reference_type text,
  reference_id bigint,
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  notes text,
  created_at timestamp with time zone not null default now()
);

-- Bring the already-created project tables up to the reproducible definition.
alter table public.products
  add column if not exists brand_id bigint references public.brands (id);

alter table public.customers
  add column if not exists updated_at timestamp with time zone not null default now();

alter table public.vendors
  add column if not exists created_at timestamp with time zone not null default now(),
  add column if not exists updated_at timestamp with time zone not null default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'created_at'
      and data_type = 'timestamp without time zone'
  ) then
    alter table public.customers
      alter column created_at type timestamp with time zone
      using created_at at time zone 'UTC';
  end if;
end
$$;

alter table public.customers
  alter column created_at set default now();

update public.customers
set created_at = now()
where created_at is null;

alter table public.customers
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchases_subtotal_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_subtotal_nonnegative check (subtotal >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchases_discount_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_discount_nonnegative check (discount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchases_tax_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_tax_nonnegative check (tax >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchases_total_nonnegative'
      and conrelid = 'public.purchases'::regclass
  ) then
    alter table public.purchases
      add constraint purchases_total_nonnegative check (total >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_items_total_cost_matches'
      and conrelid = 'public.purchase_items'::regclass
  ) then
    alter table public.purchase_items
      add constraint purchase_items_total_cost_matches
      check (total_cost = quantity * unit_cost);
  end if;
end
$$;

-- Every foreign key used for joins or referential checks gets a covering index.
create index if not exists products_brand_id_idx
  on public.products (brand_id);

create index if not exists idx_inventory_product_id
  on public.inventory (product_id);

create index if not exists idx_inventory_warehouse_id
  on public.inventory (warehouse_id);

create index if not exists purchases_vendor_id_idx
  on public.purchases (vendor_id);

create index if not exists purchases_warehouse_id_idx
  on public.purchases (warehouse_id);

create index if not exists purchases_purchase_date_idx
  on public.purchases (purchase_date);

create index if not exists purchase_items_purchase_id_idx
  on public.purchase_items (purchase_id);

create index if not exists purchase_items_product_id_idx
  on public.purchase_items (product_id);

create index if not exists idx_stock_movements_product_id
  on public.stock_movements (product_id);

create index if not exists idx_stock_movements_warehouse_id
  on public.stock_movements (warehouse_id);

create index if not exists stock_movements_reference_idx
  on public.stock_movements (reference_type, reference_id)
  where reference_id is not null;

create index if not exists idx_stock_movements_created_at
  on public.stock_movements (created_at);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

drop trigger if exists set_brands_updated_at on public.brands;
create trigger set_brands_updated_at
before update on public.brands
for each row execute function private.set_updated_at();

drop trigger if exists set_customers_updated_at on public.customers;
create trigger set_customers_updated_at
before update on public.customers
for each row execute function private.set_updated_at();

drop trigger if exists set_vendors_updated_at on public.vendors;
create trigger set_vendors_updated_at
before update on public.vendors
for each row execute function private.set_updated_at();

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
before update on public.products
for each row execute function private.set_updated_at();

drop trigger if exists set_warehouses_updated_at on public.warehouses;
create trigger set_warehouses_updated_at
before update on public.warehouses
for each row execute function private.set_updated_at();

drop trigger if exists set_inventory_updated_at on public.inventory;
create trigger set_inventory_updated_at
before update on public.inventory
for each row execute function private.set_updated_at();

drop trigger if exists set_purchases_updated_at on public.purchases;
create trigger set_purchases_updated_at
before update on public.purchases
for each row execute function private.set_updated_at();

drop trigger if exists set_purchase_items_updated_at on public.purchase_items;
create trigger set_purchase_items_updated_at
before update on public.purchase_items
for each row execute function private.set_updated_at();

-- Records the purchase header, lines, stock ledger, and inventory balance in one
-- database transaction. The function is deliberately unavailable to frontend
-- roles until application authentication and organization isolation exist.
create or replace function public.record_purchase(
  p_vendor_id bigint,
  p_warehouse_id bigint,
  p_items jsonb,
  p_purchase_date date default current_date,
  p_invoice_number text default null,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_notes text default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase_id bigint;
  v_subtotal numeric;
  v_item_count integer;
  v_distinct_product_count integer;
  v_found_product_count integer;
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0 then
    raise exception 'A purchase must contain at least one item'
      using errcode = '22023';
  end if;

  if p_discount is null or p_discount < 0 then
    raise exception 'Discount must be zero or greater'
      using errcode = '22023';
  end if;

  if p_tax is null or p_tax < 0 then
    raise exception 'Tax must be zero or greater'
      using errcode = '22023';
  end if;

  perform 1 from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor does not exist'
      using errcode = '23503';
  end if;

  perform 1 from public.warehouses where id = p_warehouse_id;
  if not found then
    raise exception 'Warehouse does not exist'
      using errcode = '23503';
  end if;

  with parsed_items as (
    select item.product_id, item.quantity, item.unit_cost
    from jsonb_to_recordset(p_items) as item(
      product_id bigint,
      quantity numeric,
      unit_cost numeric
    )
  )
  select
    count(*),
    count(distinct product_id),
    coalesce(sum(quantity * unit_cost), 0)
  into v_item_count, v_distinct_product_count, v_subtotal
  from parsed_items;

  if v_item_count <> jsonb_array_length(p_items) then
    raise exception 'Every item must be a JSON object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      product_id bigint,
      quantity numeric,
      unit_cost numeric
    )
    where item.product_id is null
      or item.quantity is null
      or item.quantity <= 0
      or item.unit_cost is null
      or item.unit_cost < 0
  ) then
    raise exception 'Each item needs a product, positive quantity, and nonnegative unit cost'
      using errcode = '22023';
  end if;

  select count(*)
  into v_found_product_count
  from public.products
  where id in (
    select distinct item.product_id
    from jsonb_to_recordset(p_items) as item(
      product_id bigint,
      quantity numeric,
      unit_cost numeric
    )
  );

  if v_found_product_count <> v_distinct_product_count then
    raise exception 'One or more products do not exist'
      using errcode = '23503';
  end if;

  if p_discount > v_subtotal then
    raise exception 'Discount cannot exceed the purchase subtotal'
      using errcode = '22023';
  end if;

  -- Lock products in a stable order so concurrent purchases cannot deadlock.
  perform product.id
  from public.products as product
  where product.id in (
    select distinct item.product_id
    from jsonb_to_recordset(p_items) as item(
      product_id bigint,
      quantity numeric,
      unit_cost numeric
    )
  )
  order by product.id
  for update;

  insert into public.purchases (
    vendor_id,
    warehouse_id,
    purchase_date,
    invoice_number,
    subtotal,
    discount,
    tax,
    total,
    notes
  )
  values (
    p_vendor_id,
    p_warehouse_id,
    coalesce(p_purchase_date, current_date),
    nullif(btrim(p_invoice_number), ''),
    v_subtotal,
    p_discount,
    p_tax,
    v_subtotal - p_discount + p_tax,
    nullif(btrim(p_notes), '')
  )
  returning id into v_purchase_id;

  insert into public.purchase_items (
    purchase_id,
    product_id,
    quantity,
    unit_cost,
    total_cost
  )
  select
    v_purchase_id,
    item.product_id,
    item.quantity,
    item.unit_cost,
    item.quantity * item.unit_cost
  from jsonb_to_recordset(p_items) as item(
    product_id bigint,
    quantity numeric,
    unit_cost numeric
  );

  insert into public.stock_movements (
    product_id,
    warehouse_id,
    movement_type,
    quantity,
    reference_type,
    reference_id,
    unit_cost,
    notes
  )
  select
    item.product_id,
    p_warehouse_id,
    'PURCHASE',
    item.quantity,
    'PURCHASE',
    v_purchase_id,
    item.unit_cost,
    nullif(btrim(p_notes), '')
  from jsonb_to_recordset(p_items) as item(
    product_id bigint,
    quantity numeric,
    unit_cost numeric
  );

  insert into public.inventory as inventory_balance (
    product_id,
    warehouse_id,
    quantity
  )
  select
    item.product_id,
    p_warehouse_id,
    sum(item.quantity)
  from jsonb_to_recordset(p_items) as item(
    product_id bigint,
    quantity numeric,
    unit_cost numeric
  )
  group by item.product_id
  on conflict (product_id, warehouse_id)
  do update
  set quantity = inventory_balance.quantity + excluded.quantity,
      updated_at = now();

  return v_purchase_id;
end;
$$;

revoke all on function public.record_purchase(
  bigint,
  bigint,
  jsonb,
  date,
  text,
  numeric,
  numeric,
  text
) from public, anon, authenticated;

grant execute on function public.record_purchase(
  bigint,
  bigint,
  jsonb,
  date,
  text,
  numeric,
  numeric,
  text
) to service_role;

-- Public tables remain inaccessible from browser-facing roles until a future
-- auth/organization migration grants narrowly scoped access.
alter table public.brands enable row level security;
alter table public.brands force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.vendors enable row level security;
alter table public.vendors force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.warehouses enable row level security;
alter table public.warehouses force row level security;
alter table public.inventory enable row level security;
alter table public.inventory force row level security;
alter table public.purchases enable row level security;
alter table public.purchases force row level security;
alter table public.purchase_items enable row level security;
alter table public.purchase_items force row level security;
alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;

drop policy if exists backend_only on public.brands;
create policy backend_only on public.brands
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.customers;
create policy backend_only on public.customers
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.vendors;
create policy backend_only on public.vendors
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.products;
create policy backend_only on public.products
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.warehouses;
create policy backend_only on public.warehouses
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.inventory;
create policy backend_only on public.inventory
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.purchases;
create policy backend_only on public.purchases
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.purchase_items;
create policy backend_only on public.purchase_items
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.stock_movements;
create policy backend_only on public.stock_movements
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table
  public.brands,
  public.customers,
  public.vendors,
  public.products,
  public.warehouses,
  public.inventory,
  public.purchases,
  public.purchase_items,
  public.stock_movements
from anon, authenticated;

grant select, insert, update, delete on table
  public.brands,
  public.customers,
  public.vendors,
  public.products,
  public.warehouses,
  public.inventory,
  public.purchases,
  public.purchase_items,
  public.stock_movements
to service_role;

grant usage, select on all sequences in schema public to service_role;
