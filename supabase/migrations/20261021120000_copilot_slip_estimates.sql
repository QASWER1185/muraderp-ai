-- A brand is a restriction before ranking/limiting, never a fuzzy preference.
create function public.search_catalog_products(
  p_user_id uuid,p_organization_id uuid,p_branch_id uuid,p_query text,p_brand text,p_limit integer default 10
) returns table(id bigint,name text,sku text,unit text,category text,brand_name text,confidence real,match_kind text)
language plpgsql stable security invoker set search_path='' set statement_timeout='3000ms' as $$
declare q text:=private.entity_search_normalize(replace(p_query,'"',' inch'));
begin
  if not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'products.read'),false)
    or not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'sales.read'),false)
    or not coalesce(public.has_branch_access_for_user(p_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501',message='Authorized organization and branch required';
  end if;
  if p_query is null or length(p_query)>120 or length(q)<2 or nullif(btrim(p_brand),'') is null then return; end if;
  return query
    with eligible as (
      select p.id,p.name,p.sku,p.unit,p.category,b.name as brand_name,
        private.entity_search_normalize(replace(p.name,'"',' inch')||' '||p.sku||' '||p.category||' '||p.unit||' '||b.name) as document
      from public.products p join public.brands b on b.id=p.brand_id and b.organization_id=p.organization_id
      where p.organization_id=p_organization_id
        and private.entity_search_normalize(b.name)=private.entity_search_normalize(p_brand)
        and exists (
          select 1 from public.rate_list_items i join public.rate_list_versions v on v.id=i.rate_list_version_id
          join public.rate_lists l on l.id=v.rate_list_id
          where i.product_id=p.id and l.organization_id=p_organization_id and l.price_type='SALE' and l.is_active
            and v.status='ACTIVE' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
        )
    ), scored as (
      select e.id,e.name,e.sku,e.unit,e.category,e.brand_name,
        case when private.entity_search_normalize(e.sku)=q or private.entity_search_normalize(e.name)=q then 1.0::real
          else private.entity_search_score(q,e.document) end as confidence,
        case when private.entity_search_normalize(e.sku)=q then 'exact_sku'
          when private.entity_search_normalize(e.name)=q then 'exact_name' else 'fuzzy' end as match_kind
      from eligible e
    )
    select s.* from scored s where s.confidence>=0.65 order by s.confidence desc,s.id
      limit greatest(2,least(coalesce(p_limit,10),20));
end $$;
revoke all on function public.search_catalog_products(uuid,uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.search_catalog_products(uuid,uuid,uuid,text,text,integer) to service_role;

create table public.copilot_customer_estimate_requests (
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid not null, idempotency_key text not null check(length(idempotency_key) between 1 and 255),
  fingerprint text not null, result jsonb not null,
  primary key(organization_id,actor_user_id,idempotency_key)
);
alter table public.copilot_customer_estimate_requests enable row level security;
alter table public.copilot_customer_estimate_requests force row level security;
revoke all on public.copilot_customer_estimate_requests from public,anon,authenticated;
grant select,insert on public.copilot_customer_estimate_requests to service_role;

-- Invoked only for the approved chained proposal. Customer + estimate + replay
-- receipt share one transaction: a failed line cannot leave an orphan customer.
create function public.create_copilot_customer_estimate(
  p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_idempotency_key text,
  p_customer jsonb,p_definition jsonb,p_lines jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_fingerprint text:=md5(jsonb_build_array(p_branch_id,p_customer,p_definition,p_lines)::text);
  v_existing public.copilot_customer_estimate_requests%rowtype;
  v_customer_id bigint;
  v_result jsonb;
begin
  if not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'sales.create'),false)
    or not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'customers.write'),false)
    or not coalesce(public.has_branch_access_for_user(p_actor_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501',message='Customer and estimate permission required';
  end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255
    or nullif(btrim(p_customer->>'name'),'') is null or length(p_customer->>'name')>200
    or p_customer->>'city' is null or length(p_customer->>'city')>200 then
    raise exception using errcode='22023',message='Customer name and idempotency are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||'customer-estimate',0));
  select * into v_existing from public.copilot_customer_estimate_requests
    where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.fingerprint<>v_fingerprint then raise exception using errcode='23505',message='Estimate idempotency conflict'; end if;
    return v_existing.result;
  end if;
  select c.id into v_customer_id from public.customers c where c.organization_id=p_organization_id
    and private.customer_search_normalize(c.name)=private.customer_search_normalize(p_customer->>'name')
    and lower(btrim(c.city))=lower(btrim(p_customer->>'city')) order by c.id limit 1;
  if not found then
    insert into public.customers(organization_id,name,city,phone)
      values(p_organization_id,btrim(p_customer->>'name'),btrim(p_customer->>'city'),coalesce(p_customer->>'phone',''))
      returning id into v_customer_id;
  end if;
  v_result:=public.create_estimate_atomic(
    p_definition||jsonb_build_object('organization_id',p_organization_id,'customer_id',v_customer_id),
    p_lines,'AI_ASSISTED',null,p_branch_id,p_actor_user_id,p_idempotency_key);
  insert into public.copilot_customer_estimate_requests values(p_organization_id,p_actor_user_id,p_idempotency_key,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.create_copilot_customer_estimate(uuid,uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_copilot_customer_estimate(uuid,uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
