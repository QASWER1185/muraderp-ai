-- MuradERP-AI Phase 2B purchase safety.
--
-- Adds transactional purchase idempotency and database-enforced supplier
-- invoice uniqueness without introducing direct mutation endpoints.

create table if not exists public.purchase_idempotency_keys (
  id bigint generated always as identity primary key,
  principal_scope text not null check (btrim(principal_scope) <> ''),
  operation text not null check (operation = 'purchase.create'),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('PROCESSING', 'COMPLETED')),
  purchase_id bigint references public.purchases (id),
  response_status integer,
  response_body jsonb,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  expires_at timestamp with time zone not null default (now() + interval '365 days'),
  constraint purchase_idempotency_completed_state check (
    (status = 'PROCESSING' and purchase_id is null and response_status is null and response_body is null and completed_at is null)
    or
    (status = 'COMPLETED' and purchase_id is not null and response_status = 201 and response_body is not null and completed_at is not null)
  )
);

create unique index if not exists purchase_idempotency_scope_key_unique_idx
  on public.purchase_idempotency_keys (principal_scope, operation, idempotency_key);

create unique index if not exists purchase_idempotency_purchase_unique_idx
  on public.purchase_idempotency_keys (purchase_id)
  where purchase_id is not null;

create index if not exists purchase_idempotency_expires_at_idx
  on public.purchase_idempotency_keys (expires_at);

create unique index if not exists purchases_vendor_invoice_unique_idx
  on public.purchases (
    vendor_id,
    lower(nullif(btrim(invoice_number), ''))
  )
  where nullif(btrim(invoice_number), '') is not null;

alter table public.purchase_idempotency_keys enable row level security;
alter table public.purchase_idempotency_keys force row level security;

drop policy if exists backend_only on public.purchase_idempotency_keys;
create policy backend_only on public.purchase_idempotency_keys
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.purchase_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on table public.purchase_idempotency_keys to service_role;
grant usage, select on sequence public.purchase_idempotency_keys_id_seq to service_role;

-- Replace the legacy eight-argument purchase function rather than leaving two
-- overloaded record_purchase contracts in the production schema.
drop function if exists public.record_purchase(
  bigint,
  bigint,
  jsonb,
  date,
  text,
  numeric,
  numeric,
  text
);

create function public.record_purchase(
  p_vendor_id bigint,
  p_warehouse_id bigint,
  p_items jsonb,
  p_purchase_date date default current_date,
  p_invoice_number text default null,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_notes text default null,
  p_idempotency_principal text default null,
  p_idempotency_operation text default 'purchase.create',
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns jsonb
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
  v_normalized_invoice text;
  v_existing_fingerprint text;
  v_existing_status text;
  v_existing_response jsonb;
  v_existing_response_status integer;
  v_purchase_json jsonb;
  v_items_json jsonb;
  v_response_body jsonb;
  v_constraint_name text;
  v_error_message text;
begin
  if p_idempotency_principal is null or btrim(p_idempotency_principal) = '' then
    raise exception 'Idempotency principal is required'
      using errcode = '22023';
  end if;

  if p_idempotency_operation <> 'purchase.create' then
    raise exception 'Unsupported idempotency operation'
      using errcode = '22023';
  end if;

  if p_idempotency_key is null
    or btrim(p_idempotency_key) = ''
    or length(p_idempotency_key) > 255 then
    raise exception 'A valid Idempotency-Key is required'
      using errcode = '22023';
  end if;

  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid request fingerprint is required'
      using errcode = '22023';
  end if;

  insert into public.purchase_idempotency_keys (
    principal_scope,
    operation,
    idempotency_key,
    request_fingerprint,
    status
  )
  values (
    btrim(p_idempotency_principal),
    p_idempotency_operation,
    btrim(p_idempotency_key),
    p_request_fingerprint,
    'PROCESSING'
  )
  on conflict (principal_scope, operation, idempotency_key) do nothing;

  select
    request_fingerprint,
    status,
    response_status,
    response_body
  into
    v_existing_fingerprint,
    v_existing_status,
    v_existing_response_status,
    v_existing_response
  from public.purchase_idempotency_keys
  where principal_scope = btrim(p_idempotency_principal)
    and operation = p_idempotency_operation
    and idempotency_key = btrim(p_idempotency_key)
  for update;

  if v_existing_fingerprint <> p_request_fingerprint then
    raise exception 'Idempotency-Key was already used for a different purchase request'
      using errcode = 'P0001';
  end if;

  if v_existing_status = 'COMPLETED' then
    return jsonb_build_object(
      'replayed', true,
      'response_status', v_existing_response_status,
      'response_body', v_existing_response
    );
  end if;

  if v_existing_status <> 'PROCESSING' then
    raise exception 'Unexpected idempotency state'
      using errcode = 'P0003';
  end if;

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

  v_normalized_invoice := nullif(btrim(p_invoice_number), '');

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

  begin
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
      v_normalized_invoice,
      v_subtotal,
      p_discount,
      p_tax,
      v_subtotal - p_discount + p_tax,
      nullif(btrim(p_notes), '')
    )
    returning id into v_purchase_id;
  exception when unique_violation then
    get stacked diagnostics
      v_constraint_name = constraint_name,
      v_error_message = message_text;

    if v_constraint_name = 'purchases_vendor_invoice_unique_idx'
      or position('purchases_vendor_invoice_unique_idx' in coalesce(v_error_message, '')) > 0 then
      raise exception 'The vendor invoice number already exists'
        using errcode = 'P0002';
    end if;

    raise;
  end;

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

  select to_jsonb(purchase_row)
  into v_purchase_json
  from public.purchases as purchase_row
  where purchase_row.id = v_purchase_id;

  select coalesce(jsonb_agg(to_jsonb(item_row) order by item_row.id), '[]'::jsonb)
  into v_items_json
  from public.purchase_items as item_row
  where item_row.purchase_id = v_purchase_id;

  v_response_body := jsonb_build_object(
    'data', jsonb_build_object(
      'purchase', v_purchase_json,
      'items', v_items_json
    )
  );

  update public.purchase_idempotency_keys
  set status = 'COMPLETED',
      purchase_id = v_purchase_id,
      response_status = 201,
      response_body = v_response_body,
      completed_at = now()
  where principal_scope = btrim(p_idempotency_principal)
    and operation = p_idempotency_operation
    and idempotency_key = btrim(p_idempotency_key);

  return jsonb_build_object(
    'replayed', false,
    'response_status', 201,
    'response_body', v_response_body
  );
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
  text,
  text,
  text,
  text,
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
  text,
  text,
  text,
  text,
  text
) to service_role;
