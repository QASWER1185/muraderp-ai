create table if not exists public.ai_copilot_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  intent text not null check (intent in ('estimate','invoice','customer_return','supplier_bill','inventory_adjustment')),
  status text not null check (status in ('DRAFT','CONFIRMED','EXECUTED','REJECTED','FAILED')) default 'DRAFT',
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 255),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  action_plan jsonb not null,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  executed_at timestamptz,
  unique (organization_id, idempotency_key)
);

alter table public.ai_copilot_actions enable row level security;
create index if not exists ai_copilot_actions_org_created_idx on public.ai_copilot_actions (organization_id, created_at desc);

create or replace function public.record_inventory_adjustment(
  p_product_id bigint,
  p_warehouse_id bigint,
  p_new_quantity numeric,
  p_reason text,
  p_principal_id text,
  p_idempotency_key text,
  p_request_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inventory_id bigint;
  v_old_quantity numeric;
  v_delta numeric;
  v_movement_id bigint;
begin
  if p_new_quantity < 0 then raise exception using errcode = '22023', message = 'new quantity cannot be negative'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception using errcode = '22023', message = 'adjustment reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_product_id::text || ':' || p_warehouse_id::text, 0));
  select id, quantity into v_inventory_id, v_old_quantity from public.inventory where product_id = p_product_id and warehouse_id = p_warehouse_id for update;
  if v_inventory_id is null then
    insert into public.inventory(product_id, warehouse_id, quantity) values (p_product_id, p_warehouse_id, 0) returning id, quantity into v_inventory_id, v_old_quantity;
  end if;
  v_delta := p_new_quantity - v_old_quantity;
  update public.inventory set quantity = p_new_quantity, updated_at = now() where id = v_inventory_id;
  if v_delta <> 0 then
    insert into public.stock_movements(product_id, warehouse_id, movement_type, quantity, reference_type, unit_cost, notes)
    values (p_product_id, p_warehouse_id, 'ADJUSTMENT', abs(v_delta), 'AI_COPILOT', null, p_reason)
    returning id into v_movement_id;
  end if;
  return jsonb_build_object('product_id', p_product_id, 'warehouse_id', p_warehouse_id, 'old_quantity', v_old_quantity, 'new_quantity', p_new_quantity, 'delta', v_delta, 'movement_id', v_movement_id, 'principal_id', p_principal_id, 'idempotency_key', p_idempotency_key, 'request_fingerprint', p_request_fingerprint);
end;
$$;

revoke execute on function public.record_inventory_adjustment(bigint,bigint,numeric,text,text,text,text) from public, anon, authenticated;
grant execute on function public.record_inventory_adjustment(bigint,bigint,numeric,text,text,text,text) to service_role;
