-- Additive editor: no existing estimate or accounting record is changed.
create or replace function public.update_estimate_scoped(
  p_organization_id uuid, p_branch_id uuid, p_actor_user_id uuid,
  p_estimate_id bigint, p_changes jsonb
) returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_estimate public.estimates%rowtype;
  v_status text;
  v_line jsonb;
  v_number integer := 0;
begin
  if not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'sales.create'),false)
     or not coalesce(public.has_branch_access_for_user(p_actor_user_id,p_organization_id,p_branch_id),false) then
    raise exception 'Active sales permission and branch access are required' using errcode='42501';
  end if;
  select * into v_estimate from public.estimates where id=p_estimate_id
    and organization_id=p_organization_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Estimate is not available in this workspace'; end if;
  if (p_changes->>'expected_updated_at')::timestamptz is distinct from v_estimate.updated_at then
    raise exception 'Estimate changed; reload the preview before saving' using errcode='40001';
  end if;
  v_status := coalesce(p_changes->>'status',v_estimate.status);
  if v_estimate.status in ('CONVERTED','CANCELLED') then
    raise exception 'Invoiced and cancelled estimates are read only';
  end if;
  -- Conversion is exclusively handled by the authoritative invoice transaction.
  if v_status='INVOICED' then
    raise exception 'Use Convert to Invoice to post an invoice and mark this estimate invoiced';
  end if;
  if v_status not in ('DRAFT','READY','CANCELLED') or
     (v_estimate.status='READY' and v_status not in ('READY','CANCELLED')) then
    raise exception 'Invalid estimate status transition';
  end if;
  if v_estimate.status<>'DRAFT' and (p_changes ? 'lines' or p_changes ? 'customer_id' or p_changes ? 'issue_date' or p_changes ? 'notes') then
    raise exception 'Only draft estimates can be edited';
  end if;
  if p_changes ? 'customer_id' and not exists(select 1 from public.customers where id=(p_changes->>'customer_id')::bigint and organization_id=p_organization_id) then
    raise exception 'Customer is not available in this organization';
  end if;
  if p_changes ? 'lines' then
    if jsonb_typeof(p_changes->'lines')<>'array' or jsonb_array_length(p_changes->'lines') not between 1 and 500 then raise exception 'Provide 1 to 500 estimate lines'; end if;
    for v_line in select value from jsonb_array_elements(p_changes->'lines') loop
      if not exists(select 1 from public.products where id=(v_line->>'product_id')::bigint and organization_id=p_organization_id) then raise exception 'Product is not available in this organization'; end if;
      if (v_line->>'quantity')::numeric <= 0 or (v_line->>'unit_price')::numeric < 0
        or coalesce((v_line->>'discount_amount')::numeric,0) not between 0 and (v_line->>'quantity')::numeric*(v_line->>'unit_price')::numeric
        or nullif(btrim(v_line->>'unit'),'') is null then raise exception 'Invalid estimate line quantity, rate, discount or unit'; end if;
    end loop;
    delete from public.estimate_items where estimate_id=p_estimate_id;
    for v_line in select value from jsonb_array_elements(p_changes->'lines') loop
      v_number:=v_number+1;
      insert into public.estimate_items(estimate_id,line_number,product_id,description,quantity,unit,unit_price,discount_amount,pricing_source,rate_list_selection_source,manual_unit_price,line_amount,pricing_provenance)
      values(p_estimate_id,v_number,(v_line->>'product_id')::bigint,v_line->>'description',(v_line->>'quantity')::numeric,v_line->>'unit',(v_line->>'unit_price')::numeric,coalesce((v_line->>'discount_amount')::numeric,0),'MANUAL_OVERRIDE','MANUAL',(v_line->>'unit_price')::numeric,
        round((v_line->>'quantity')::numeric*(v_line->>'unit_price')::numeric-coalesce((v_line->>'discount_amount')::numeric,0),2),jsonb_build_object('pricing_source','MANUAL_OVERRIDE','source','estimate-editor'));
    end loop;
  end if;
  if v_status='READY' and not exists(select 1 from public.estimate_items where estimate_id=p_estimate_id) then raise exception 'An empty estimate cannot be ready'; end if;
  update public.estimates set status=v_status,
    notes=case when p_changes ? 'notes' then p_changes->>'notes' else notes end,
    customer_id=coalesce((p_changes->>'customer_id')::bigint,customer_id),
    issue_date=coalesce((p_changes->>'issue_date')::date,issue_date),updated_at=clock_timestamp()
  where id=p_estimate_id;
end;
$$;
revoke all on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) to service_role;

-- Repair a missing grant without weakening membership or explicit branch ACLs.
insert into public.role_permissions(role,permission_code)
select role, permission_code from unnest(array['owner','admin']) role
cross join unnest(array['purchases.read','purchases.create','purchases.approve']) permission_code
on conflict do nothing;
