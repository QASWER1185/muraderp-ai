alter table public.stock_movements add column if not exists quantity_delta numeric;
create table public.stock_adjustment_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null, actor_user_id uuid not null, adjusted_by text not null,
  product_id bigint not null references public.products(id), warehouse_id bigint not null references public.warehouses(id),
  quantity_before numeric not null, quantity_delta numeric not null, quantity_after numeric not null,
  reason text not null, created_at timestamptz not null default now()
);
alter table public.stock_adjustment_events enable row level security;
revoke all on public.stock_adjustment_events from public,anon,authenticated;
create function public.adjust_stock_atomic(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_product_id bigint,p_warehouse_id bigint,p_quantity_delta numeric,p_reason text,p_adjusted_by text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare before_qty numeric; after_qty numeric; event_id bigint;
begin
  if not public.is_organization_member_for_user(p_actor_user_id,p_organization_id) then raise exception using errcode='42501',message='Active organization membership required';end if;
  if p_quantity_delta is null or p_quantity_delta=0 or p_quantity_delta::text in ('NaN','Infinity','-Infinity') or coalesce(btrim(p_reason),'')='' or coalesce(btrim(p_adjusted_by),'')='' then raise exception using errcode='22023',message='A finite nonzero quantity, reason, and adjusted_by are required';end if;
  if not exists(select 1 from public.products where id=p_product_id and organization_id=p_organization_id) or not exists(select 1 from public.warehouses where id=p_warehouse_id and organization_id=p_organization_id) or not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception using errcode='42501',message='Product, warehouse and branch must belong to this organization';end if;
  insert into public.inventory(organization_id,product_id,warehouse_id,quantity) values(p_organization_id,p_product_id,p_warehouse_id,0) on conflict(product_id,warehouse_id) do nothing;
  select quantity into before_qty from public.inventory where organization_id=p_organization_id and product_id=p_product_id and warehouse_id=p_warehouse_id for update;
  if not found then raise exception using errcode='42501',message='Inventory belongs to another organization';end if;
  after_qty:=before_qty+p_quantity_delta;
  if after_qty<0 then raise exception using errcode='23514',message='Adjustment would make stock negative';end if;
  update public.inventory set quantity=after_qty,updated_at=now() where organization_id=p_organization_id and product_id=p_product_id and warehouse_id=p_warehouse_id;
  insert into public.stock_adjustment_events(organization_id,branch_id,actor_user_id,adjusted_by,product_id,warehouse_id,quantity_before,quantity_delta,quantity_after,reason) values(p_organization_id,p_branch_id,p_actor_user_id,p_adjusted_by,p_product_id,p_warehouse_id,before_qty,p_quantity_delta,after_qty,p_reason) returning id into event_id;
  insert into public.stock_movements(organization_id,branch_id,product_id,warehouse_id,movement_type,quantity,quantity_delta,reference_type,reference_id,notes) values(p_organization_id,p_branch_id,p_product_id,p_warehouse_id,'ADJUSTMENT',abs(p_quantity_delta),p_quantity_delta,'STOCK_ADJUSTMENT',event_id,p_reason);
  return jsonb_build_object('adjustment_id',event_id,'quantity_before',before_qty,'quantity_delta',p_quantity_delta,'quantity_after',after_qty);
end $$;
revoke all on function public.adjust_stock_atomic(uuid,uuid,uuid,bigint,bigint,numeric,text,text) from public,anon,authenticated;
grant execute on function public.adjust_stock_atomic(uuid,uuid,uuid,bigint,bigint,numeric,text,text) to service_role;
