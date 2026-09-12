create or replace function public.create_rate_list_draft_version(
  p_organization_id uuid,
  p_rate_list_id bigint,
  p_version_number integer,
  p_effective_from timestamptz,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version public.rate_list_versions%rowtype;
  v_items jsonb;
begin
  if p_organization_id is null then raise exception 'organization_id is required'; end if;
  if p_rate_list_id is null or p_rate_list_id <= 0 then raise exception 'rate_list_id must be a positive integer'; end if;
  if p_version_number is null or p_version_number <= 0 then raise exception 'version_number must be a positive integer'; end if;
  if p_effective_from is null then raise exception 'effective_from is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'rate-list draft requires at least one item';
  end if;
  if jsonb_array_length(p_items) > 500 then raise exception 'rate-list draft cannot contain more than 500 items'; end if;

  perform 1 from public.rate_lists
  where id = p_rate_list_id and organization_id = p_organization_id and is_active = true;
  if not found then raise exception 'rate list does not belong to the organization or is inactive'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(product_id bigint, minimum_quantity numeric, unit_price numeric, unit text)
    left join public.products product
      on product.id = item.product_id and product.organization_id = p_organization_id
    where product.id is null
       or item.product_id is null or item.product_id <= 0
       or item.minimum_quantity is null or item.minimum_quantity <= 0
       or item.unit_price is null or item.unit_price < 0
       or item.unit is null or btrim(item.unit) = ''
  ) then
    raise exception 'rate-list draft contains invalid or cross-organization items';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(product_id bigint, minimum_quantity numeric)
    group by item.product_id, item.minimum_quantity
    having count(*) > 1
  ) then
    raise exception 'rate-list draft contains a duplicate product/quantity tier';
  end if;

  insert into public.rate_list_versions(rate_list_id, version_number, status, effective_from)
  values (p_rate_list_id, p_version_number, 'DRAFT', p_effective_from)
  returning * into v_version;

  with inserted as (
    insert into public.rate_list_items(rate_list_version_id, product_id, minimum_quantity, unit_price, unit)
    select v_version.id, item.product_id, item.minimum_quantity, item.unit_price, btrim(item.unit)
    from jsonb_to_recordset(p_items) as item(product_id bigint, minimum_quantity numeric, unit_price numeric, unit text)
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_items from inserted;

  return jsonb_build_object('version', to_jsonb(v_version), 'items', v_items);
end;
$$;

revoke all on function public.create_rate_list_draft_version(uuid, bigint, integer, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_rate_list_draft_version(uuid, bigint, integer, timestamptz, jsonb)
  to service_role;

comment on function public.create_rate_list_draft_version(uuid, bigint, integer, timestamptz, jsonb) is
  'Atomically imports a confirmed Copilot proposal as a tenant-checked DRAFT rate-list version. Publication remains a separate controlled lifecycle action.';
