-- Phase 1: authoritative estimate creation and complete line pricing context.
-- This is forward-only. The existing tables have the metadata columns needed
-- for pricing selection, but no transaction boundary spanning the header and
-- all lines; a database RPC is therefore required to prevent orphan headers.

alter table public.estimates
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid;

alter table public.estimates
  add constraint estimates_phase1_branch_ownership_fkey
  foreign key (organization_id, branch_id)
  references public.branches(organization_id, id)
  on delete restrict;

alter table public.estimates
  add constraint estimates_phase1_actor_fkey
  foreign key (actor_user_id)
  references auth.users(id)
  on delete restrict;

create index if not exists estimates_phase1_branch_idx
  on public.estimates (organization_id, branch_id, issue_date desc);

alter table public.estimate_items
  add column if not exists line_amount numeric,
  add column if not exists pricing_provenance jsonb;

alter table public.estimate_items
  drop constraint if exists estimate_items_line_amount_check;
alter table public.estimate_items
  add constraint estimate_items_line_amount_check
  check (line_amount is null or line_amount >= 0);

create table if not exists public.estimate_idempotency_keys (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  actor_user_id uuid not null,
  operation text not null default 'estimate.create',
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 255),
  request_fingerprint text not null,
  conversion_request jsonb,
  response_snapshot jsonb,
  estimate_id bigint references public.estimates(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint estimate_idempotency_unique unique (organization_id, actor_user_id, operation, idempotency_key)
);
alter table public.estimate_idempotency_keys enable row level security;
alter table public.estimate_idempotency_keys force row level security;
drop policy if exists backend_only on public.estimate_idempotency_keys;
create policy backend_only on public.estimate_idempotency_keys for all to anon, authenticated using (false) with check (false);
revoke all on public.estimate_idempotency_keys from anon, authenticated;
grant select, insert, update on public.estimate_idempotency_keys to service_role;
grant usage, select on sequence public.estimate_idempotency_keys_id_seq to service_role;

-- One statement captures the header and ordered items from the same MVCC snapshot.
create or replace function public.estimate_conversion_snapshot(p_estimate_id bigint, p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select payload || jsonb_build_object('source_fingerprint', md5(payload::text))
  from (
    select jsonb_build_object('record', to_jsonb(e), 'items', coalesce(
      (select jsonb_agg(to_jsonb(i) order by i.line_number) from public.estimate_items i where i.estimate_id = e.id), '[]'::jsonb
    )) as payload from public.estimates e where e.id = p_estimate_id and e.organization_id = p_organization_id
  ) snapshot;
$$;
revoke all on function public.estimate_conversion_snapshot(bigint,uuid) from public, anon, authenticated;
grant execute on function public.estimate_conversion_snapshot(bigint,uuid) to service_role;

-- The function is SECURITY INVOKER: it is callable only by the trusted
-- service_role and still performs explicit organization/branch/user checks.
create or replace function public.create_estimate_atomic(
  p_definition jsonb,
  p_lines jsonb,
  p_source_type text default 'MANUAL',
  p_source_reference text default null,
  p_branch_id uuid default null,
  p_actor_user_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_branch_id uuid := p_branch_id;
  v_actor_user_id uuid := p_actor_user_id;
  v_customer_id bigint;
  v_estimate public.estimates%rowtype;
  v_item public.estimate_items%rowtype;
  v_line jsonb;
  v_line_number integer;
  v_product_id bigint;
  v_rate_list_id bigint;
  v_rate_list_version_id bigint;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_amount numeric;
  v_selection_source text;
  v_pricing_source text;
  v_brand_hint text;
  v_seen_lines integer[] := array[]::integer[];
  v_items jsonb := '[]'::jsonb;
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_existing_estimate_id bigint;
  v_reserved boolean;
  v_row_count integer;
  v_source_id bigint;
  v_source public.estimates%rowtype;
  v_source_line public.estimate_items%rowtype;
  v_rate record;
  v_conversion jsonb := p_definition->'conversion_request';
begin
  if p_definition is null or jsonb_typeof(p_definition) <> 'object' then
    raise exception using errcode = '22023', message = 'estimate definition is required';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'estimate must contain at least one line';
  end if;

  begin
    v_organization_id := nullif(btrim(p_definition->>'organization_id'), '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'organization_id must be a valid UUID';
  end;
  if v_organization_id is null then
    raise exception using errcode = '22023', message = 'organization_id is required';
  end if;
  if v_branch_id is null then
    raise exception using errcode = '42501', message = 'branch_id is required for atomic estimate creation';
  end if;
  if v_actor_user_id is null then
    raise exception using errcode = '42501', message = 'actor_user_id is required for atomic estimate creation';
  end if;
  if not exists (
    select 1 from public.branches b
    where b.id = v_branch_id
      and b.organization_id = v_organization_id
      and b.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'branch is not active in the estimate organization';
  end if;
  if not public.is_organization_member_for_user(v_actor_user_id, v_organization_id)
     or not public.has_permission_for_user(v_actor_user_id, v_organization_id, 'sales.create')
     or not public.has_branch_access_for_user(v_actor_user_id, v_organization_id, v_branch_id) then
    raise exception using errcode = '42501', message = 'actor is not authorized for the estimate organization and branch';
  end if;

  begin
    v_customer_id := nullif(p_definition->>'customer_id', '')::bigint;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'customer_id must be a positive integer';
  end;
  if v_customer_id is null or v_customer_id <= 0 then
    raise exception using errcode = '22023', message = 'customer_id must be a positive integer';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id = v_customer_id and c.organization_id = v_organization_id
  ) then
    raise exception using errcode = '23503', message = 'customer is not owned by the estimate organization';
  end if;
  if coalesce(btrim(p_definition->>'estimate_number'), '') = '' then
    raise exception using errcode = '22023', message = 'estimate_number is required';
  end if;
  if coalesce(btrim(p_definition->>'currency_code'), '') = '' then
    raise exception using errcode = '22023', message = 'currency_code is required';
  end if;
  if p_source_type not in ('MANUAL', 'OCR', 'VOICE', 'IMPORT', 'AI_ASSISTED') then
    raise exception using errcode = '22023', message = 'source_type is invalid';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    if length(btrim(p_idempotency_key)) > 255 then
      raise exception using errcode = '22023', message = 'idempotency_key is too long';
    end if;
    v_request_fingerprint := md5(coalesce(p_definition::text, '') || '|' || coalesce(p_lines::text, '') || '|' || coalesce(p_source_type, '') || '|' || coalesce(p_source_reference, '') || '|' || coalesce(p_branch_id::text, ''));
    insert into public.estimate_idempotency_keys (organization_id, actor_user_id, operation, idempotency_key, request_fingerprint, conversion_request)
    values (v_organization_id, v_actor_user_id, 'estimate.create', btrim(p_idempotency_key), v_request_fingerprint, v_conversion)
    on conflict (organization_id, actor_user_id, operation, idempotency_key) do nothing;
    get diagnostics v_row_count = row_count;
    v_reserved := v_row_count > 0;
    if not v_reserved then
      select request_fingerprint, estimate_id into v_existing_fingerprint, v_existing_estimate_id
      from public.estimate_idempotency_keys
      where organization_id = v_organization_id and actor_user_id = v_actor_user_id
        and operation = 'estimate.create' and idempotency_key = btrim(p_idempotency_key)
      for update;
      if v_existing_fingerprint <> v_request_fingerprint then
        raise exception using errcode = '23505', message = 'idempotency key was reused for a different estimate request';
      end if;
      if v_existing_estimate_id is null then
        raise exception using errcode = 'P0003', message = 'estimate idempotency request is already being processed';
      end if;
      select response_snapshot into v_items from public.estimate_idempotency_keys
        where organization_id = v_organization_id and actor_user_id = v_actor_user_id
          and operation = 'estimate.create' and idempotency_key = btrim(p_idempotency_key);
      if v_items is null then raise exception using errcode = '23503', message = 'idempotent estimate no longer exists'; end if;
      return v_items;
    end if;
  end if;

  if v_conversion is not null then
    if nullif(btrim(p_idempotency_key), '') is null or v_conversion->>'mode' not in ('REPRICE_ALL_TO_TARGET_RATE_LIST','PRESERVE_LINE_BRAND_CONTEXT') then
      raise exception using errcode = '22023', message = 'conversion requires idempotency and an explicit policy';
    end if;
    v_source_id := (v_conversion->>'source_estimate_id')::bigint;
    select * into v_source from public.estimates where id = v_source_id and organization_id = v_organization_id for update;
    if not found or v_source.branch_id is distinct from v_branch_id then
      raise exception using errcode = '42501', message = 'source estimate organization or branch mismatch';
    end if;
    perform 1 from public.estimate_items where estimate_id = v_source_id for share;
    if (public.estimate_conversion_snapshot(v_source_id, v_organization_id)->>'source_fingerprint') is distinct from (p_definition->>'source_fingerprint') then
      raise exception using errcode = '40001', message = 'source estimate changed; generate a new preview';
    end if;
    if v_source.customer_id <> v_customer_id or v_source.currency_code <> p_definition->>'currency_code'
       or v_source.issue_date <> (p_definition->>'issue_date')::date
       or v_source.notes is distinct from p_definition->>'notes'
       or v_source.layout_key <> coalesce(p_definition->>'layout_key', 'CLASSIC_PAKISTAN')
       or v_source.pass_through_rent <> coalesce((p_definition->>'pass_through_rent')::numeric, 0)
       or v_source.pass_through_rent_payee is distinct from p_definition->>'pass_through_rent_payee'
       or (select count(*) from public.estimate_items where estimate_id = v_source_id) <> jsonb_array_length(p_lines) then
      raise exception using errcode = '22023', message = 'conversion must preserve source structure and metadata';
    end if;
  end if;

  -- Validate every authoritative reference before inserting the header.
  for v_line in select value from jsonb_array_elements(p_lines) loop
    begin
      v_line_number := nullif(v_line->>'line_number', '')::integer;
      v_product_id := nullif(v_line->>'product_id', '')::bigint;
      v_quantity := nullif(v_line->>'quantity', '')::numeric;
      v_unit_price := nullif(v_line->>'unit_price', '')::numeric;
      v_discount := coalesce(nullif(v_line->>'discount_amount', '')::numeric, 0);
      v_rate_list_id := nullif(v_line->>'rate_list_id', '')::bigint;
      v_rate_list_version_id := nullif(v_line->>'rate_list_version_id', '')::bigint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'estimate line contains an invalid numeric value';
    end;
    if v_line_number is null or v_line_number <= 0 or v_line_number = any(v_seen_lines) then
      raise exception using errcode = '23505', message = 'estimate line_number must be unique and positive';
    end if;
    v_seen_lines := array_append(v_seen_lines, v_line_number);
    if v_product_id is null or v_product_id <= 0 or not exists (
      select 1 from public.products p
      where p.id = v_product_id and p.organization_id = v_organization_id
    ) then
      raise exception using errcode = '23503', message = 'estimate line Product is not owned by the estimate organization';
    end if;
    if v_quantity is null or v_quantity <= 0 or v_unit_price is null or v_unit_price < 0 or v_discount < 0 then
      raise exception using errcode = '22023', message = 'estimate line quantity, price, and discount are invalid';
    end if;
    if v_quantity::text in ('NaN','Infinity','-Infinity') or v_unit_price::text in ('NaN','Infinity','-Infinity') or v_discount::text in ('NaN','Infinity','-Infinity') then
      raise exception using errcode = '22023', message = 'estimate numeric values must be finite';
    end if;
    if coalesce(btrim(v_line->>'unit'), '') = '' then
      raise exception using errcode = '22023', message = 'estimate line unit is required';
    end if;
    v_pricing_source := coalesce(nullif(v_line->>'pricing_source', ''), 'RESOLVED_RATE');
    if v_pricing_source not in ('RESOLVED_RATE', 'MANUAL_OVERRIDE') then
      raise exception using errcode = '22023', message = 'estimate line pricing_source is invalid';
    end if;
    v_selection_source := case coalesce(nullif(v_line->>'rate_list_selection_source', ''), 'INHERITED')
      when 'ESTIMATE_DEFAULT' then 'INHERITED'
      when 'OCR_BRAND_MATCH' then 'AI_SUGGESTED'
      when 'VOICE_BRAND_MATCH' then 'AI_SUGGESTED'
      when 'MANUAL_OVERRIDE' then 'MANUAL'
      else coalesce(nullif(v_line->>'rate_list_selection_source', ''), 'INHERITED')
    end;
    if v_selection_source not in ('INHERITED', 'LINE_OVERRIDE', 'AI_SUGGESTED', 'MANUAL') then
      raise exception using errcode = '22023', message = 'estimate line pricing selection source is invalid';
    end if;
    v_brand_hint := nullif(btrim(v_line->>'brand_hint'), '');
    if v_brand_hint is not null and v_rate_list_id is null then
      raise exception using errcode = '42200', message = 'brand/company hint requires an explicit line rate list';
    end if;
    if v_rate_list_id is not null then
      if not exists (
        select 1 from public.rate_lists rl
        where rl.id = v_rate_list_id and rl.organization_id = v_organization_id
      ) then
        raise exception using errcode = '23503', message = 'estimate line rate list is not owned by the estimate organization';
      end if;
      if v_rate_list_version_id is not null and not exists (
        select 1 from public.rate_list_versions rlv
        join public.rate_lists rl on rl.id = rlv.rate_list_id
        where rlv.id = v_rate_list_version_id
          and rlv.rate_list_id = v_rate_list_id
          and rl.organization_id = v_organization_id
      ) then
        raise exception using errcode = '23503', message = 'estimate line rate list version does not belong to the selected list';
      end if;
    elsif v_rate_list_version_id is not null then
      raise exception using errcode = '23503', message = 'estimate line rate list version requires a rate list';
    end if;
    if v_conversion is not null then
      select * into v_source_line from public.estimate_items where estimate_id = v_source_id and line_number = v_line_number;
      if not found or v_source_line.product_id <> v_product_id or v_source_line.quantity <> v_quantity
         or v_source_line.unit <> v_line->>'unit' or v_source_line.discount_amount <> v_discount
         or v_source_line.description is distinct from v_line->>'description' then
        raise exception using errcode = '22023', message = 'conversion must preserve every source line';
      end if;
      if v_conversion->>'mode' = 'PRESERVE_LINE_BRAND_CONTEXT' then
        if v_rate_list_id is distinct from v_source_line.rate_list_id or v_brand_hint is distinct from v_source_line.brand_hint then
          raise exception using errcode = '22023', message = 'preserve mode cannot replace line context';
        end if;
      elsif v_rate_list_id is distinct from (v_conversion->>'target_rate_list_id')::bigint or v_brand_hint is not null then
        raise exception using errcode = '22023', message = 'all-to-target mode must use the target list without stale brand hints';
      end if;
      select ri.unit_price, ri.unit, ri.minimum_quantity, rl.currency_code into v_rate
      from public.rate_list_items ri join public.rate_list_versions rv on rv.id = ri.rate_list_version_id
      join public.rate_lists rl on rl.id = rv.rate_list_id
      where ri.id = (v_line->'resolved_price'->>'rate_list_item_id')::bigint and ri.product_id = v_product_id
        and rv.id = v_rate_list_version_id and rl.id = v_rate_list_id and rl.organization_id = v_organization_id
        and rl.is_active and rl.price_type = 'SALE' and (rl.scope_type <> 'CUSTOMER' or rl.customer_id = v_customer_id)
        and rv.status = 'ACTIVE' and rv.effective_from <= (v_conversion->>'pricing_date')::timestamptz
        and (rv.effective_to is null or rv.effective_to > (v_conversion->>'pricing_date')::timestamptz)
      for share of ri, rv, rl;
      if not found or v_pricing_source <> 'RESOLVED_RATE' or v_rate.unit_price <> v_unit_price
         or v_rate.unit <> v_line->>'unit' or v_rate.currency_code <> p_definition->>'currency_code'
         or v_rate.minimum_quantity > v_quantity then
        raise exception using errcode = '40001', message = 'approved pricing changed or is invalid; generate a new preview';
      end if;
    end if;
  end loop;

  insert into public.estimates (
    organization_id, branch_id, actor_user_id, customer_id, estimate_number,
    issue_date, currency_code, status, notes, source_type, source_reference,
    pass_through_rent, pass_through_rent_payee, layout_key
  ) values (
    v_organization_id, v_branch_id, v_actor_user_id, v_customer_id,
    btrim(p_definition->>'estimate_number'),
    coalesce(nullif(p_definition->>'issue_date', '')::date, current_date),
    upper(btrim(p_definition->>'currency_code')), 'DRAFT',
    p_definition->>'notes', p_source_type, p_source_reference,
    coalesce(nullif(p_definition->>'pass_through_rent', '')::numeric, 0),
    p_definition->>'pass_through_rent_payee', coalesce(p_definition->>'layout_key','CLASSIC_PAKISTAN')
  ) returning * into v_estimate;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_number := (v_line->>'line_number')::integer;
    v_product_id := (v_line->>'product_id')::bigint;
    v_quantity := (v_line->>'quantity')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;
    v_discount := coalesce((v_line->>'discount_amount')::numeric, 0);
    v_rate_list_id := nullif(v_line->>'rate_list_id', '')::bigint;
    v_rate_list_version_id := nullif(v_line->>'rate_list_version_id', '')::bigint;
    v_selection_source := case coalesce(nullif(v_line->>'rate_list_selection_source', ''), 'INHERITED')
      when 'ESTIMATE_DEFAULT' then 'INHERITED' when 'OCR_BRAND_MATCH' then 'AI_SUGGESTED'
      when 'VOICE_BRAND_MATCH' then 'AI_SUGGESTED' when 'MANUAL_OVERRIDE' then 'MANUAL'
      else coalesce(nullif(v_line->>'rate_list_selection_source', ''), 'INHERITED') end;
    v_pricing_source := coalesce(nullif(v_line->>'pricing_source', ''), 'RESOLVED_RATE');
    v_brand_hint := nullif(btrim(v_line->>'brand_hint'), '');
    v_line_amount := v_quantity * v_unit_price - v_discount;
    if v_line_amount < 0 then
      raise exception using errcode = '22023', message = 'estimate line amount cannot be negative';
    end if;
    insert into public.estimate_items (
      estimate_id, line_number, product_id, description, quantity, unit,
      unit_price, discount_amount, pricing_source, rate_list_id,
      rate_list_version_id, rate_list_selection_source, brand_hint,
      manual_unit_price, line_amount, pricing_provenance
    ) values (
      v_estimate.id, v_line_number, v_product_id, nullif(v_line->>'description', ''),
      v_quantity, btrim(v_line->>'unit'), v_unit_price, v_discount, v_pricing_source,
      v_rate_list_id, v_rate_list_version_id, v_selection_source, v_brand_hint,
      case when v_pricing_source = 'MANUAL_OVERRIDE' then v_unit_price else null end,
      v_line_amount,
      jsonb_build_object(
        'product_id', v_product_id,
        'rate_list_id', v_rate_list_id,
        'rate_list_version_id', v_rate_list_version_id,
        'selection_source', v_selection_source,
        'brand_hint', v_brand_hint,
        'pricing_source', v_pricing_source,
        'manual_unit_price', case when v_pricing_source = 'MANUAL_OVERRIDE' then v_unit_price else null end,
        'quantity', v_quantity,
        'unit', btrim(v_line->>'unit'),
        'discount_amount', v_discount,
        'line_amount', v_line_amount,
        'resolved_price', coalesce(v_line->'resolved_price', 'null'::jsonb)
      )
    ) returning * into v_item;
    v_items := v_items || jsonb_build_array(to_jsonb(v_item));
  end loop;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    update public.estimate_idempotency_keys
    set estimate_id = v_estimate.id, response_snapshot = jsonb_build_object('estimate', to_jsonb(v_estimate), 'items', v_items)
    where organization_id = v_organization_id and actor_user_id = v_actor_user_id
      and operation = 'estimate.create' and idempotency_key = btrim(p_idempotency_key);
  end if;

  return jsonb_build_object('estimate', to_jsonb(v_estimate), 'items', v_items);
end;
$$;

revoke all on function public.create_estimate_atomic(jsonb, jsonb, text, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_estimate_atomic(jsonb, jsonb, text, text, uuid, uuid, text)
  to service_role;
