begin;
-- Full in-place estimate editor. Installing this function changes no records.
create or replace function public.update_estimate_scoped(
  p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,
  p_estimate_id bigint,p_changes jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare
  v_estimate public.estimates%rowtype;
  v_original public.estimate_items%rowtype;
  v_line jsonb;
  v_status text;
  v_ids bigint[] := '{}'::bigint[];
  v_id bigint;
  v_number integer := 0;
  v_qty numeric; v_rate numeric; v_percent numeric; v_discount numeric;
  v_old_list numeric; v_old_percent numeric;
  v_keep_price boolean;
begin
  if not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'sales.create'),false)
    or not coalesce(public.has_branch_access_for_user(p_actor_user_id,p_organization_id,p_branch_id),false) then
    raise exception 'Active sales permission and branch access are required' using errcode='42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'object' or
     p_changes - array['expected_updated_at','status','customer_id','issue_date','document_template','pass_through_rent','notes','lines'] <> '{}'::jsonb then
    raise exception 'Unsupported estimate fields; the estimate number is locked';
  end if;
  select * into v_estimate from public.estimates where id=p_estimate_id
    and organization_id=p_organization_id and branch_id=p_branch_id for update;
  if not found then raise exception 'Estimate is not available in this workspace'; end if;
  if (p_changes->>'expected_updated_at')::timestamptz is distinct from v_estimate.updated_at then
    raise exception 'Estimate changed; reload the preview before saving' using errcode='40001';
  end if;
  if v_estimate.status not in ('DRAFT','READY') then raise exception 'Invoiced and cancelled estimates are read only'; end if;
  v_status:=coalesce(p_changes->>'status',v_estimate.status);
  if v_status not in ('DRAFT','READY','CANCELLED') or (v_estimate.status='READY' and v_status='DRAFT') then
    raise exception 'Use Convert to Invoice for invoicing, and preserve the current estimate workflow';
  end if;
  if p_changes ? 'customer_id' and not exists(select 1 from public.customers where id=(p_changes->>'customer_id')::bigint and organization_id=p_organization_id) then
    raise exception 'Customer is not available in this organization';
  end if;
  if p_changes ? 'document_template' and coalesce(p_changes->>'document_template','') not in ('sanitary_electric','building_material') then raise exception 'Invalid document template'; end if;
  if p_changes ? 'pass_through_rent' and (p_changes->>'pass_through_rent' is null or (p_changes->>'pass_through_rent')::numeric<0 or (p_changes->>'pass_through_rent')::numeric::text in ('NaN','Infinity','-Infinity')) then raise exception 'Carriage must be finite and nonnegative'; end if;
  if p_changes ? 'lines' then
    if jsonb_typeof(p_changes->'lines') is distinct from 'array' then raise exception 'Provide an estimate line array'; end if;
    if jsonb_array_length(p_changes->'lines') not between 1 and 500 then raise exception 'Provide 1 to 500 estimate lines'; end if;
    -- Validate every reference and value before touching any line.
    for v_line in select value from jsonb_array_elements(p_changes->'lines') loop
      if v_line - array['id','product_id','description','quantity','unit','unit_price','list_price','discount_percent','discount_amount'] <> '{}'::jsonb then raise exception 'Unsupported estimate line fields'; end if;
      v_id:=nullif(v_line->>'id','')::bigint;
      if v_id is not null then
        if v_id=any(v_ids) or not exists(select 1 from public.estimate_items where id=v_id and estimate_id=p_estimate_id) then raise exception 'Line is duplicated or does not belong to this estimate'; end if;
        v_ids:=array_append(v_ids,v_id);
      end if;
      if not exists(select 1 from public.products where id=(v_line->>'product_id')::bigint and organization_id=p_organization_id) then raise exception 'Product is not available in this organization'; end if;
      if v_line ? 'list_price' and v_line ? 'unit_price' then raise exception 'Choose a list rate or a legacy saved rate'; end if;
      if v_line ? 'discount_percent' and (not(v_line ? 'list_price') or v_line ? 'discount_amount') then raise exception 'Percentage discount requires a list rate and no amount discount'; end if;
      v_qty:=(v_line->>'quantity')::numeric;
      v_rate:=coalesce(v_line->>'list_price',v_line->>'unit_price')::numeric;
      v_percent:=coalesce((v_line->>'discount_percent')::numeric,0);
      v_discount:=case when v_line ? 'discount_percent' then v_qty*v_rate*v_percent/100 else coalesce((v_line->>'discount_amount')::numeric,0) end;
      if v_qty is null or v_rate is null or v_qty<=0 or v_rate<0 or v_percent not between 0 and 100 or v_discount not between 0 and v_qty*v_rate
        or v_qty::text in ('NaN','Infinity','-Infinity') or v_rate::text in ('NaN','Infinity','-Infinity')
        or nullif(btrim(v_line->>'unit'),'') is null or length(v_line->>'unit')>50 or length(v_line->>'description')>500 then raise exception 'Invalid quantity, unit, rate or discount'; end if;
    end loop;
    delete from public.estimate_items where estimate_id=p_estimate_id and not(id=any(v_ids));
    -- Temporary line numbers avoid uniqueness collisions during reordering.
    update public.estimate_items set line_number=line_number+1000 where estimate_id=p_estimate_id;
    for v_line in select value from jsonb_array_elements(p_changes->'lines') loop
      v_number:=v_number+1;v_id:=nullif(v_line->>'id','')::bigint;
      v_qty:=(v_line->>'quantity')::numeric;v_rate:=coalesce(v_line->>'list_price',v_line->>'unit_price')::numeric;
      v_percent:=coalesce((v_line->>'discount_percent')::numeric,0);
      v_discount:=case when v_line ? 'discount_percent' then v_qty*v_rate*v_percent/100 else coalesce((v_line->>'discount_amount')::numeric,0) end;
      if not(v_line ? 'discount_percent') then v_percent:=case when v_qty*v_rate>0 then v_discount/(v_qty*v_rate)*100 else 0 end; end if;
      v_keep_price:=false;
      if v_id is not null then
        select * into v_original from public.estimate_items where id=v_id and estimate_id=p_estimate_id;
        v_old_list:=coalesce((v_original.pricing_provenance->>'list_price')::numeric,v_original.unit_price);
        v_old_percent:=coalesce((v_original.pricing_provenance->>'discount_percent')::numeric,case when v_old_list*v_original.quantity>0 then (v_old_list*v_original.quantity-round(v_original.quantity*v_original.unit_price-v_original.discount_amount,2))/(v_old_list*v_original.quantity)*100 else 0 end);
        v_keep_price:=(v_line ? 'list_price') and v_original.product_id=(v_line->>'product_id')::bigint and v_original.quantity=v_qty and v_original.unit=v_line->>'unit' and v_old_list=v_rate and abs(v_old_percent-v_percent)<0.00000001;
        update public.estimate_items set line_number=v_number,product_id=(v_line->>'product_id')::bigint,
          description=case when v_line ? 'description' then nullif(btrim(v_line->>'description'),'') else description end,
          quantity=v_qty,unit=v_line->>'unit',
          unit_price=case when v_keep_price then unit_price else v_rate end,
          discount_amount=case when v_keep_price then discount_amount else v_discount end,
          pricing_source=case when v_keep_price then pricing_source else 'MANUAL_OVERRIDE' end,
          rate_list_selection_source=case when v_keep_price then rate_list_selection_source else 'MANUAL' end,
          rate_list_id=case when v_keep_price then rate_list_id else null end,
          rate_list_version_id=case when v_keep_price then rate_list_version_id else null end,
          manual_unit_price=case when v_keep_price then manual_unit_price else v_rate end,
          line_amount=case when v_keep_price then line_amount else round(v_qty*v_rate-v_discount,2) end,
          pricing_provenance=case when v_keep_price then pricing_provenance else jsonb_build_object('pricing_source','MANUAL_OVERRIDE','source','estimate-editor','list_price',v_rate,'discount_percent',v_percent) end,
          updated_at=clock_timestamp()
        where id=v_id and estimate_id=p_estimate_id;
      else
        insert into public.estimate_items(estimate_id,line_number,product_id,description,quantity,unit,unit_price,discount_amount,pricing_source,rate_list_selection_source,manual_unit_price,line_amount,pricing_provenance)
        values(p_estimate_id,v_number,(v_line->>'product_id')::bigint,nullif(btrim(v_line->>'description'),''),v_qty,v_line->>'unit',v_rate,v_discount,'MANUAL_OVERRIDE','MANUAL',v_rate,round(v_qty*v_rate-v_discount,2),jsonb_build_object('pricing_source','MANUAL_OVERRIDE','source','estimate-editor','list_price',v_rate,'discount_percent',v_percent));
      end if;
    end loop;
  end if;
  if v_status='READY' and not exists(select 1 from public.estimate_items where estimate_id=p_estimate_id) then raise exception 'An empty estimate cannot be ready'; end if;
  -- Financial totals are derived from the saved line snapshots by estimateView
  -- and the conversion snapshot, so there is no second stale total to maintain.
  update public.estimates set status=v_status,
    customer_id=coalesce((p_changes->>'customer_id')::bigint,customer_id),
    issue_date=coalesce((p_changes->>'issue_date')::date,issue_date),
    document_template=coalesce(p_changes->>'document_template',document_template),
    pass_through_rent=coalesce((p_changes->>'pass_through_rent')::numeric,pass_through_rent),
    notes=case when p_changes ? 'notes' then p_changes->>'notes' else notes end,
    updated_at=clock_timestamp()
  where id=p_estimate_id and organization_id=p_organization_id and branch_id=p_branch_id;
end;
$$;
revoke all on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) to service_role;
revoke all on function public.update_estimate_scoped_template_impl(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;

commit;
