-- Forward-only correction: customer name/city are varchar, RPC outputs are text.
-- Existing RPC grants and ranking are preserved; no master data changes.
-- Load pg_trgm before declaring its user-settable function configuration.
select extensions.word_similarity('migration', 'migration');

create or replace function public.search_customers_fuzzy(
  p_user_id uuid, p_organization_id uuid, p_branch_id uuid, p_query text, p_limit integer default 10
) returns table(id bigint, name text, city text, confidence real, match_kind text)
language plpgsql stable security invoker set search_path = ''
set pg_trgm.word_similarity_threshold = '0.45' set statement_timeout = '3000ms' as $$
declare q text := private.customer_search_normalize(p_query); anchor text; phone_query text;
begin
  if not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'customers.read'),false)
     or not coalesce(public.has_branch_access_for_user(p_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501', message='Authorized organization and branch context required';
  end if;
  if p_query is null or length(p_query)>120 or length(q)<2 then return; end if;
  select token into anchor from unnest(string_to_array(q,' ')) token where token<>''
    order by length(token) desc, token limit 1;
  phone_query := regexp_replace(p_query,'[^0-9]','','g');
  return query
  with candidate_ids as (
    select c.id from public.customers c where c.organization_id=p_organization_id
      and private.customer_search_normalize(c.name || ' ' || coalesce(c.city,'')) operator(extensions.%>) anchor
    union
    select c.id from public.customers c where c.organization_id=p_organization_id
      and private.customer_search_key(c.name)=private.customer_search_key(q)
    union
    select c.id from public.customers c where c.organization_id=p_organization_id
      and length(phone_query)>=7 and p_query ~ '^[+0-9() -]+$'
      and regexp_replace(c.phone,'[^0-9]','','g')=phone_query
  ), scored as (
    select c.id,c.name::text,c.city::text,
      case when private.customer_search_normalize(c.name)=q then 1.0::real
           when length(phone_query)>=7 and p_query ~ '^[+0-9() -]+$' and regexp_replace(c.phone,'[^0-9]','','g')=phone_query then 1.0::real
           when private.customer_search_key(c.name)=private.customer_search_key(q) then 0.92::real
           else private.entity_search_score(q,private.customer_search_normalize(c.name || ' ' || coalesce(c.city,''))) end as confidence,
      case when private.customer_search_normalize(c.name)=q then 'exact_name'
           when length(phone_query)>=7 and p_query ~ '^[+0-9() -]+$' and regexp_replace(c.phone,'[^0-9]','','g')=phone_query then 'exact_phone'
           when private.customer_search_key(c.name)=private.customer_search_key(q) then 'phonetic' else 'fuzzy' end as match_kind
    from candidate_ids ids join public.customers c on c.id=ids.id and c.organization_id=p_organization_id
  ) select s.* from scored s where s.confidence>=0.65
    order by s.confidence desc,s.id limit greatest(2,least(coalesce(p_limit,10),20));
end $$;

