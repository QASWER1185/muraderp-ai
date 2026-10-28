-- Native draft-only persistence. Unlisted rows never become invoice products.
alter table public.estimate_items alter column product_id drop not null;
alter table public.estimate_items add column is_unlisted boolean not null default false;
alter table public.estimate_items add column is_pending boolean not null default false;
alter table public.estimate_items add constraint estimate_item_product_or_unlisted
  check (product_id is not null or is_unlisted);
alter table public.estimate_items add constraint estimate_pending_zero_price
  check (not is_pending or (unit_price=0 and discount_amount=0));

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
     or (new.product_id is not null and not exists (
       select 1 from public.products p
       where p.id = new.product_id
         and p.organization_id = v_estimate_organization
     )) or (new.product_id is null and (not new.is_unlisted or not exists (
       select 1 from public.estimates e where e.id=new.estimate_id and e.status='DRAFT'
         and e.source_type='AI_ASSISTED' and e.source_reference like 'copilot-demand:%'
     ))) then
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

create function public.guard_pending_estimate_status() returns trigger
language plpgsql set search_path='' as $$ begin
  if new.status in ('READY','CONVERTED') and exists(
    select 1 from public.estimate_items where estimate_id=new.id and (is_pending or product_id is null)
  ) then raise exception 'Resolve pending rates and link unlisted products before READY or invoice conversion' using errcode='22023'; end if;
  return new;
end $$;
create trigger guard_pending_estimate_status before update of status on public.estimates
  for each row execute function public.guard_pending_estimate_status();

create function public.save_copilot_demand_estimate(
  p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_action_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_action jsonb; v_data jsonb; v_line jsonb; v_est public.estimates%rowtype;
  v_id bigint; v_customer bigint; v_existing bigint; v_count integer:=0;
begin
  if not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'sales.create'),false)
    or not coalesce(public.has_branch_access_for_user(p_actor_user_id,p_organization_id,p_branch_id),false) then
    raise exception 'Estimate permission and branch access required' using errcode='42501'; end if;
  select action_plan->'unifiedAction' into v_action from public.ai_copilot_actions
    where id=p_action_id and organization_id=p_organization_id and user_id=p_actor_user_id
      and status='DRAFT' and action_plan->>'branchId'=p_branch_id::text for update;
  v_data:=v_action->'data';
  if v_action->>'tool'<>'erp_create_estimate' or v_data->>'mode'<>'DEMAND_SLIP_ESTIMATE'
    or v_data is null or jsonb_array_length(v_data->'lines') not between 1 and 500 then
    raise exception 'Scoped prepared demand estimate required'; end if;
  v_customer:=(v_data->>'customerId')::bigint;
  if not exists(select 1 from public.customers where id=v_customer and organization_id=p_organization_id) then
    raise exception 'Prepared customer must belong to this organization'; end if;
  v_existing:=(v_data->>'nativeEstimateId')::bigint;
  if v_existing is not null then
    select * into v_est from public.estimates where id=v_existing and organization_id=p_organization_id
      and branch_id=p_branch_id and source_type='AI_ASSISTED' and source_reference like 'copilot-demand:%' for update;
    if not found or v_est.status<>'DRAFT' then raise exception 'Saved demand estimate is no longer editable'; end if;
  else
    select * into v_est from public.estimates where organization_id=p_organization_id
      and branch_id=p_branch_id and source_reference='copilot-demand:'||p_action_id::text for update;
    if found then return jsonb_build_object('id',v_est.id,'estimate_number',v_est.estimate_number,'status',v_est.status); end if;
    insert into public.estimates(organization_id,branch_id,customer_id,estimate_number,issue_date,currency_code,status,source_type,source_reference,notes,actor_user_id)
      values(p_organization_id,p_branch_id,v_customer,'EST-AI-'||upper(left(replace(p_action_id::text,'-',''),12)),
        coalesce((v_data->>'date')::date,current_date),'PKR','DRAFT','AI_ASSISTED','copilot-demand:'||p_action_id::text,
        'Copilot demand draft. Pending rows have no final rate; resolve and link all products before invoicing.',p_actor_user_id) returning * into v_est;
  end if;
  v_id:=v_est.id;
  delete from public.estimate_items where estimate_id=v_id;
  for v_line in select value from jsonb_array_elements(v_data->'lines') loop
    v_count:=v_count+1;
    if v_line->>'product_id' is not null and not exists(select 1 from public.products
      where id=(v_line->>'product_id')::bigint and organization_id=p_organization_id) then
      raise exception 'Prepared product is outside this organization'; end if;
    insert into public.estimate_items(estimate_id,line_number,product_id,description,quantity,unit,unit_price,discount_amount,
      pricing_source,rate_list_id,rate_list_version_id,pricing_provenance,is_unlisted,is_pending,line_amount)
    values(v_id,v_count,(v_line->>'product_id')::bigint,v_line->>'productName',(v_line->>'quantity')::numeric,
      coalesce(nullif(v_line->>'unit',''),'pcs'),coalesce((v_line->>'unit_price')::numeric,0),coalesce((v_line->>'discount_amount')::numeric,0),
      case when v_line->>'pricing_source'='RESOLVED_RATE' then 'RESOLVED_RATE' else 'MANUAL_OVERRIDE' end,
      (v_line->>'rate_list_id')::bigint,(v_line->>'rate_list_version_id')::bigint,
      jsonb_build_object('list_price',coalesce((v_line->>'unit_price')::numeric,0),'discount_percent',coalesce((v_line->>'discountPercent')::numeric,0),
        'copilot_demand',true,'pending_reason',v_line->>'pendingReason','owner_rate',v_line->>'ownerRate'),
      v_line->>'product_id' is null,coalesce((v_line->>'pending')::boolean,false),coalesce((v_line->>'unit_price')::numeric,0)*(v_line->>'quantity')::numeric-coalesce((v_line->>'discount_amount')::numeric,0));
  end loop;
  update public.estimates set customer_id=v_customer,updated_at=now() where id=v_id;
  update public.ai_copilot_actions set action_plan=jsonb_set(action_plan,'{unifiedAction,data,nativeEstimateId}',to_jsonb(v_id)) where id=p_action_id;
  return jsonb_build_object('id',v_id,'estimate_number',v_est.estimate_number,'status','DRAFT','line_count',v_count);
end $$;
revoke all on function public.save_copilot_demand_estimate(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_copilot_demand_estimate(uuid,uuid,uuid,uuid) to service_role;
