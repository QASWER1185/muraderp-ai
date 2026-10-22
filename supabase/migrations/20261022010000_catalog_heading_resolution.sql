-- Imported family names may omit PPR-C/U-PVC, which exists in the rate-list
-- heading. Search only active catalog rows of the requested brand, preserving
-- numeric qualifiers from product data rather than dates in catalog headings.
create or replace function public.search_catalog_products(
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
        private.entity_search_normalize(replace(p.name,'"',' inch')||' '||p.sku||' '||p.category||' '||p.unit||' '||b.name||' '||
          string_agg(distinct regexp_replace(l.name,'[0-9]+','','g'),' ')) as document
      from public.rate_list_items i
      join public.rate_list_versions v on v.id=i.rate_list_version_id
      join public.rate_lists l on l.id=v.rate_list_id
      join public.products p on p.id=i.product_id and p.organization_id=l.organization_id
      join public.brands b on b.id=p.brand_id and b.organization_id=p.organization_id
      where p.organization_id=p_organization_id
        and private.entity_search_normalize(b.name)=private.entity_search_normalize(p_brand)
        and l.price_type='SALE' and l.is_active and i.unit=p.unit
        and v.status='ACTIVE' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
        and (q !~ '\mpprc\M' or private.entity_search_normalize(p.name||' '||l.name) ~ '\mpprc\M')
        and (q !~ '\mu ?pvc\M' or private.entity_search_normalize(p.name||' '||l.name) ~ '\mu ?pvc\M')
      group by p.id,p.name,p.sku,p.unit,p.category,b.name
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
notify pgrst, 'reload schema';
