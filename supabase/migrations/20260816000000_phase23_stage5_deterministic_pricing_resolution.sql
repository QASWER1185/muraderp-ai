-- Phase 23 Stage 5: deterministic pricing resolution.
--
-- Resolution is authoritative and backend-controlled. The resolver accepts only
-- deterministic inputs: an explicit user rate, an explicitly selected rate list,
-- customer/vendor context, and the requested quantity. AI has no override path.

create or replace function public.resolve_rate_list_price(
  p_product_id bigint,
  p_quantity numeric,
  p_price_type text,
  p_vendor_id bigint default null,
  p_customer_id bigint default null,
  p_explicit_unit_price numeric default null,
  p_rate_list_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_unit text;
  v_rate_list_id bigint;
  v_rate_list_name text;
  v_rate_list_code text;
  v_version_id bigint;
  v_version_number integer;
  v_minimum_quantity numeric;
  v_unit_price numeric;
  v_source text;
  v_scope_type text;
  v_candidate_count integer;
  v_item_count integer;
begin
  if p_product_id is null or p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'Product and quantity must be valid';
  end if;

  if p_price_type not in ('PURCHASE', 'SALE') then
    raise exception using errcode = '22023', message = 'Unsupported price type';
  end if;

  if p_explicit_unit_price is not null then
    if p_explicit_unit_price < 0 then
      raise exception using errcode = '22023', message = 'Explicit unit price cannot be negative';
    end if;

    select unit into v_product_unit
    from public.products
    where id = p_product_id;

    if v_product_unit is null then
      raise exception using errcode = 'P0005', message = 'Product could not be resolved';
    end if;

    return jsonb_build_object(
      'unit_price', p_explicit_unit_price,
      'unit', v_product_unit,
      'source', 'EXPLICIT_USER_RATE',
      'rate_list_id', null,
      'rate_list_code', null,
      'rate_list_version_id', null,
      'rate_list_version_number', null,
      'minimum_quantity', null
    );
  end if;

  if p_rate_list_id is not null then
    select count(*) into v_candidate_count
    from public.rate_lists rl
    where rl.id = p_rate_list_id
      and rl.is_active = true
      and rl.price_type = p_price_type;

    if v_candidate_count = 0 then
      raise exception using errcode = 'P0005', message = 'Selected rate list could not be resolved';
    end if;

    v_rate_list_id := p_rate_list_id;
    v_source := 'EXPLICIT_RATE_LIST';
  else
    -- Deterministic precedence: CUSTOMER > VENDOR > GLOBAL.
    if p_customer_id is not null then
      select count(*) into v_candidate_count
      from public.rate_lists rl
      where rl.is_active = true
        and rl.price_type = p_price_type
        and rl.scope_type = 'CUSTOMER'
        and rl.customer_id = p_customer_id;

      if v_candidate_count > 1 then
        raise exception using errcode = 'P0004', message = 'Ambiguous customer pricing: multiple active rate lists match';
      elsif v_candidate_count = 1 then
        select rl.id into v_rate_list_id
        from public.rate_lists rl
        where rl.is_active = true
          and rl.price_type = p_price_type
          and rl.scope_type = 'CUSTOMER'
          and rl.customer_id = p_customer_id;
        v_source := 'CUSTOMER_RATE_LIST';
      end if;
    end if;

    if v_rate_list_id is null and p_vendor_id is not null then
      select count(*) into v_candidate_count
      from public.rate_lists rl
      where rl.is_active = true
        and rl.price_type = p_price_type
        and rl.scope_type = 'VENDOR'
        and rl.vendor_id = p_vendor_id;

      if v_candidate_count > 1 then
        raise exception using errcode = 'P0004', message = 'Ambiguous vendor pricing: multiple active rate lists match';
      elsif v_candidate_count = 1 then
        select rl.id into v_rate_list_id
        from public.rate_lists rl
        where rl.is_active = true
          and rl.price_type = p_price_type
          and rl.scope_type = 'VENDOR'
          and rl.vendor_id = p_vendor_id;
        v_source := 'VENDOR_RATE_LIST';
      end if;
    end if;

    if v_rate_list_id is null then
      select count(*) into v_candidate_count
      from public.rate_lists rl
      where rl.is_active = true
        and rl.price_type = p_price_type
        and rl.scope_type = 'GLOBAL';

      if v_candidate_count > 1 then
        raise exception using errcode = 'P0004', message = 'Ambiguous global pricing: multiple active rate lists match';
      elsif v_candidate_count = 1 then
        select rl.id into v_rate_list_id
        from public.rate_lists rl
        where rl.is_active = true
          and rl.price_type = p_price_type
          and rl.scope_type = 'GLOBAL';
        v_source := 'GLOBAL_RATE_LIST';
      end if;
    end if;
  end if;

  if v_rate_list_id is null then
    raise exception using errcode = 'P0005', message = 'No deterministic rate list could be resolved';
  end if;

  select rl.name, rl.code, rl.scope_type
    into v_rate_list_name, v_rate_list_code, v_scope_type
  from public.rate_lists rl
  where rl.id = v_rate_list_id;

  select count(*) into v_candidate_count
  from public.rate_list_versions rv
  where rv.rate_list_id = v_rate_list_id
    and rv.status = 'ACTIVE'
    and rv.effective_from <= now()
    and (rv.effective_to is null or rv.effective_to > now());

  if v_candidate_count > 1 then
    raise exception using errcode = 'P0004', message = 'Ambiguous active rate-list version';
  elsif v_candidate_count = 0 then
    raise exception using errcode = 'P0005', message = 'No effective active rate-list version could be resolved';
  end if;

  select rv.id, rv.version_number
    into v_version_id, v_version_number
  from public.rate_list_versions rv
  where rv.rate_list_id = v_rate_list_id
    and rv.status = 'ACTIVE'
    and rv.effective_from <= now()
    and (rv.effective_to is null or rv.effective_to > now());

  select count(*) into v_item_count
  from public.rate_list_items rli
  where rli.rate_list_version_id = v_version_id
    and rli.product_id = p_product_id
    and rli.minimum_quantity <= p_quantity;

  if v_item_count = 0 then
    raise exception using errcode = 'P0005', message = 'No price tier exists for the requested product and quantity';
  end if;

  select rli.minimum_quantity, rli.unit_price, rli.unit
    into v_minimum_quantity, v_unit_price, v_product_unit
  from public.rate_list_items rli
  where rli.rate_list_version_id = v_version_id
    and rli.product_id = p_product_id
    and rli.minimum_quantity <= p_quantity
  order by rli.minimum_quantity desc
  limit 1;

  return jsonb_build_object(
    'unit_price', v_unit_price,
    'unit', v_product_unit,
    'source', v_source,
    'rate_list_id', v_rate_list_id,
    'rate_list_name', v_rate_list_name,
    'rate_list_code', v_rate_list_code,
    'rate_list_scope', v_scope_type,
    'rate_list_version_id', v_version_id,
    'rate_list_version_number', v_version_number,
    'minimum_quantity', v_minimum_quantity
  );
end;
$$;

revoke all on function public.resolve_rate_list_price(bigint, numeric, text, bigint, bigint, numeric, bigint) from public, anon, authenticated;
grant execute on function public.resolve_rate_list_price(bigint, numeric, text, bigint, bigint, numeric, bigint) to service_role;

comment on function public.resolve_rate_list_price(bigint, numeric, text, bigint, bigint, numeric, bigint) is
  'Authoritative deterministic pricing resolver. Precedence: explicit user rate, explicit rate list, customer, vendor, global. AI has no override input.';
