-- Only the authenticated/authorized backend may invoke this transaction, after
-- the tenant-scoped Copilot approval has been claimed. Printed rates stay gross.
alter table public.rate_list_versions add column if not exists standard_discount_percent numeric not null default 0
  check (standard_discount_percent between 0 and 100);

create table if not exists public.rate_list_catalog_imports (
  organization_id uuid not null references public.organizations(id),
  idempotency_key text not null,
  fingerprint text not null,
  result jsonb not null,
  primary key (organization_id, idempotency_key)
);
alter table public.rate_list_catalog_imports enable row level security;
revoke all on public.rate_list_catalog_imports from public, anon, authenticated;
grant all on public.rate_list_catalog_imports to service_role;

create or replace function public.import_rate_list_catalog(p_organization_id uuid, p_idempotency_key text, p_catalog jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_existing public.rate_list_catalog_imports%rowtype;
  v_list public.rate_lists%rowtype;
  v_version public.rate_list_versions%rowtype;
  v_row jsonb;
  v_brand bigint;
  v_product bigint;
  v_name text;
  v_sku text;
  v_code text;
  v_result jsonb;
  v_number integer;
begin
  if p_organization_id is null or not exists(select 1 from public.organizations where id=p_organization_id)
     or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255 then
    raise exception 'Invalid catalog import context';
  end if;
  if p_catalog->>'documentType' is distinct from 'rate_list' or p_catalog->>'complete' is distinct from 'true'
     or nullif(btrim(p_catalog->>'name'),'') is null or jsonb_typeof(p_catalog->'items') is distinct from 'array'
     or jsonb_array_length(p_catalog->'items')=0 then raise exception 'A complete catalog is required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_organization_id::text));
  select * into v_existing from public.rate_list_catalog_imports where organization_id=p_organization_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.fingerprint<>md5(p_catalog::text) then raise exception 'Catalog idempotency conflict'; end if;
    return v_existing.result;
  end if;
  v_code := 'CAT-' || md5(lower(btrim(p_catalog->>'name')));
  select * into v_list from public.rate_lists where organization_id=p_organization_id and code=v_code for update;
  if not found then
    insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code,is_active)
      values(p_organization_id,btrim(p_catalog->>'name'),v_code,'SALE','GLOBAL','PKR',true) returning * into v_list;
  end if;
  select coalesce(max(version_number),0)+1 into v_number from public.rate_list_versions where rate_list_id=v_list.id;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from,standard_discount_percent)
    values(v_list.id,v_number,'DRAFT',now(),coalesce((p_catalog->>'standardDiscountPercent')::numeric,0)) returning * into v_version;
  for v_row in select value from jsonb_array_elements(p_catalog->'items') loop
    if nullif(btrim(v_row->>'brand'),'') is null or nullif(btrim(v_row->>'name'),'') is null
      or nullif(btrim(v_row->>'size'),'') is null or nullif(btrim(v_row->>'unit'),'') is null
      or coalesce(v_row->>'category','') not in ('Pipes','Fittings','Hardware')
      or jsonb_typeof(v_row->'list_price') is distinct from 'number' or (v_row->>'list_price')::numeric<0 then
      raise exception 'Invalid catalog row';
    end if;
    select id into v_brand from public.brands where organization_id=p_organization_id and lower(name)=lower(btrim(v_row->>'brand'));
    if not found then
      insert into public.brands(organization_id,name) values(p_organization_id,btrim(v_row->>'brand')) returning id into v_brand;
    end if;
    v_name := btrim(v_row->>'brand') || ' ' || btrim(v_row->>'name') || ' ' || btrim(v_row->>'size');
    v_sku := 'CAT-' || md5(p_organization_id::text || '|' || lower(v_name) || '|' || lower(v_row->>'unit'));
    select id into v_product from public.products where organization_id=p_organization_id and sku=v_sku;
    if not found then
      insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
        values(p_organization_id,v_brand,v_name,v_sku,v_row->>'category',v_row->>'unit',0,(v_row->>'list_price')::numeric) returning id into v_product;
    end if;
    insert into public.rate_list_items(rate_list_version_id,product_id,minimum_quantity,unit_price,unit)
      values(v_version.id,v_product,1,(v_row->>'list_price')::numeric,v_row->>'unit');
  end loop;
  update public.rate_list_versions set status='ARCHIVED',effective_to=now() where rate_list_id=v_list.id and status='ACTIVE';
  update public.rate_list_versions set status='ACTIVE' where id=v_version.id returning * into v_version;
  v_result := jsonb_build_object('rate_list',to_jsonb(v_list),'version',to_jsonb(v_version),'items',
    (select jsonb_agg(to_jsonb(i) order by i.id) from public.rate_list_items i where rate_list_version_id=v_version.id));
  insert into public.rate_list_catalog_imports values(p_organization_id,p_idempotency_key,md5(p_catalog::text),v_result);
  return v_result;
end;
$$;
revoke all on function public.import_rate_list_catalog(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_rate_list_catalog(uuid,text,jsonb) to service_role;
