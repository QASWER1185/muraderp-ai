-- Search-only expressions: authoritative names, SKUs and ownership are untouched.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
do $$ begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
                 where e.extname='pg_trgm' and n.nspname='extensions') then
    raise exception 'pg_trgm must be installed in extensions before applying entity search';
  end if;
end $$;

create or replace function private.entity_search_normalize(value text)
returns text language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare v text := lower(coalesce(value, ''));
begin
  v := translate(v, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789');
  v := regexp_replace(v, 'ppr[[:space:]-]*c\M', 'pprc', 'g');
  v := regexp_replace(v, '\mpn[[:space:]-]*([0-9]+)', 'pn\1', 'g');
  v := regexp_replace(v, '\mebow\M', 'elbow', 'g');
  v := regexp_replace(v, '\mfem\M', 'female', 'g');
  v := regexp_replace(v, '([0-9])[[:space:]]*[*x×][[:space:]]*([0-9])', '\1x\2', 'g');
  v := regexp_replace(v, '([0-9])[[:space:]]*/[[:space:]]*([0-9])', '\1/\2', 'g');
  v := regexp_replace(v, '([0-9])[[:space:]]*mm\M', '\1 mm', 'g');
  v := regexp_replace(v, '[^[:alnum:]/]+', ' ', 'g');
  return btrim(regexp_replace(v, '[[:space:]]+', ' ', 'g'));
end $$;

create or replace function private.customer_search_normalize(value text)
returns text language sql immutable parallel safe security invoker set search_path = '' as $$
  select btrim(regexp_replace(private.entity_search_normalize(value),
    '\m(sahib|sahab|sb|صاحب|جناب)\M', '', 'g'));
$$;

-- Conservative cross-script consonant key, not an alias to a particular ERP ID.
-- Collisions are returned as candidates and must be clarified.
create or replace function private.customer_search_key(value text)
returns text language plpgsql immutable parallel safe security invoker set search_path = '' as $$
declare v text := private.customer_search_normalize(value);
begin
  v := translate(v, 'اآبپتٹثجچحخدڈذرڑزژسشصضطظعغفقکگلمنوہھیےؤئ',
                    'aabpttsjchhddzrrzzssszttagfqkglmnohhyywy');
  return regexp_replace(v, '[aeiou[:space:]]', '', 'g');
end $$;

-- All numeric qualifiers must match whole normalized tokens. A similar name with
-- another dimension or PN rating cannot become a high-confidence match.
create or replace function private.entity_search_score(q text, document text)
returns real language sql immutable parallel safe security invoker set search_path = '' as $$
  select case when min(case when token ~ '[0-9]' then
                          case when token = any(string_to_array(document, ' ')) then 1.0 else 0.0 end
                        else extensions.word_similarity(token, document) end) < 0.45
                   then 0.0
              else (0.65 + 0.30 * avg(case when token = any(string_to_array(document, ' '))
                                        then 1.0 else extensions.word_similarity(token, document) end))::real end
  from unnest(string_to_array(q, ' ')) token where token <> '';
$$;

create index products_entity_search_trgm on public.products using gin
  (private.entity_search_normalize(coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(category,'') || ' ' || coalesce(unit,'')) extensions.gin_trgm_ops);
create index brands_entity_search_trgm on public.brands using gin
  (private.entity_search_normalize(name) extensions.gin_trgm_ops);
create index products_entity_search_brand on public.products(organization_id, brand_id, id);
create index customers_entity_search_trgm on public.customers using gin
  (private.customer_search_normalize(coalesce(name,'') || ' ' || coalesce(city,'')) extensions.gin_trgm_ops);
create index customers_entity_search_key on public.customers
  (organization_id, private.customer_search_key(name));
create index customers_entity_search_phone on public.customers
  (organization_id, (regexp_replace(phone, '[^0-9]', '', 'g')));

create or replace function public.search_products_fuzzy(
  p_user_id uuid, p_organization_id uuid, p_branch_id uuid, p_query text, p_limit integer default 10
) returns table(id bigint, name text, sku text, unit text, category text, brand_name text, confidence real, match_kind text)
language plpgsql stable security invoker set search_path = ''
set pg_trgm.word_similarity_threshold = '0.45' set statement_timeout = '3000ms' as $$
declare q text := private.entity_search_normalize(p_query); anchor text;
begin
  if not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'products.read'),false)
     or not coalesce(public.has_branch_access_for_user(p_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501', message='Authorized organization and branch context required';
  end if;
  if p_query is null or length(p_query)>120 or length(q)<2 then return; end if;
  select token into anchor from unnest(string_to_array(q,' ')) token
    order by (token ~ '[0-9]') asc, length(token) desc, token limit 1;
  return query
  with candidate_ids as (
    select p.id from public.products p where p.organization_id=p_organization_id
      and private.entity_search_normalize(coalesce(p.name,'') || ' ' || coalesce(p.sku,'') || ' ' || coalesce(p.category,'') || ' ' || coalesce(p.unit,'')) operator(extensions.%>) anchor
    union
    select p.id from public.brands b join public.products p on p.brand_id=b.id and p.organization_id=b.organization_id
      where b.organization_id=p_organization_id and private.entity_search_normalize(b.name) operator(extensions.%>) anchor
  ), scored as (
    select p.id,p.name,p.sku,p.unit,p.category,b.name as brand_name,
      case when private.entity_search_normalize(p.sku)=q then 1.0::real
           when private.entity_search_normalize(p.name)=q then 1.0::real
           else private.entity_search_score(q, private.entity_search_normalize(p.name || ' ' || p.sku || ' ' || p.category || ' ' || p.unit || ' ' || coalesce(b.name,''))) end as confidence,
      case when private.entity_search_normalize(p.sku)=q then 'exact_sku'
           when private.entity_search_normalize(p.name)=q then 'exact_name' else 'fuzzy' end as match_kind
    from candidate_ids c join public.products p on p.id=c.id and p.organization_id=p_organization_id
    left join public.brands b on b.id=p.brand_id and b.organization_id=p_organization_id
  ) select s.* from scored s where s.confidence >= 0.65
    order by s.confidence desc, (s.match_kind='exact_sku') desc, s.id
    limit greatest(2,least(coalesce(p_limit,10),20));
end $$;

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
    select c.id,c.name,c.city,
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

-- Same trusted-service boundary as the existing P0-5 authorization RPCs.
-- Invoker rights preserve existing RLS; no SECURITY DEFINER privilege escalation.
revoke all on function public.search_products_fuzzy(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.search_customers_fuzzy(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.search_products_fuzzy(uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.search_customers_fuzzy(uuid,uuid,uuid,text,integer) to service_role;
grant usage on schema private,extensions to service_role;
revoke all on function private.entity_search_normalize(text), private.customer_search_normalize(text), private.customer_search_key(text), private.entity_search_score(text,text) from public,anon,authenticated;
grant execute on function private.entity_search_normalize(text), private.customer_search_normalize(text), private.customer_search_key(text), private.entity_search_score(text,text) to service_role;
