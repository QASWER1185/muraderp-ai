-- Read-only integrations. Existing posting functions, RLS and grants are unchanged.
create index if not exists customer_ledger_copilot_scope on public.customer_ledger_entries
  (organization_id, branch_id, customer_id, id desc);
create index if not exists customer_ledger_copilot_payment on public.customer_ledger_entries
  (organization_id, branch_id, customer_id, entry_date desc, id desc) where entry_type='PAYMENT';
create index if not exists invoices_copilot_party on public.invoices(organization_id,branch_id,customer_id,id desc);
create index if not exists purchases_copilot_party on public.purchases(organization_id,branch_id,vendor_id,id desc);
create index if not exists vendors_entity_search_trgm on public.vendors using gin
  (private.entity_search_normalize(name) extensions.gin_trgm_ops);

create or replace function public.copilot_customer_ledger(
  p_user_id uuid, p_organization_id uuid, p_branch_id uuid, p_customer_id bigint,
  p_limit integer default 10, p_before_id bigint default null
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='3000ms' as $$
declare result jsonb; bounded_limit integer := greatest(1,least(coalesce(p_limit,10),20));
begin
  if not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'accounting.read'),false)
     or not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'customers.read'),false)
     or not coalesce(public.has_branch_access_for_user(p_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501',message='Authorized customer ledger scope required';
  end if;
  if not exists(select 1 from public.customers where id=p_customer_id and organization_id=p_organization_id) then
    raise exception using errcode='22023',message='Customer unavailable in this organization';
  end if;
  with scoped as (
    select l.* from public.customer_ledger_entries l where l.organization_id=p_organization_id
      and l.branch_id=p_branch_id and l.customer_id=p_customer_id
  ), balances as (
    -- Balance is over the entire authoritative subledger, never the history page.
    select currency_code,sum(debit) debit,sum(credit) credit,sum(debit-credit) outstanding from scoped group by currency_code
  ), page as (
    select * from scoped where p_before_id is null or id<p_before_id order by id desc limit bounded_limit+1
  ), history as (
    select * from page order by id desc limit bounded_limit
  ) select jsonb_build_object(
    'balances',coalesce((select jsonb_agg(to_jsonb(b) order by currency_code) from balances b),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',h.id,'date',h.entry_date,'entryType',h.entry_type,'referenceType',h.reference_type,'referenceId',h.reference_id,
      'debit',h.debit,'credit',h.credit,'currencyCode',h.currency_code,'description',h.description,
      'journals',coalesce((select jsonb_agg(jsonb_build_object('id',j.id,'date',j.entry_date,'sourceType',j.source_type,'status',j.status))
        from public.journal_entries j where j.organization_id=p_organization_id and j.branch_id=p_branch_id
          and j.source_type=h.reference_type and j.source_record_id=h.reference_id::text and j.status='POSTED'),'[]'::jsonb)
    ) order by h.id desc) from history h),'[]'::jsonb),
    'nextCursor',case when (select count(*) from page)>bounded_limit then (select min(id) from history) else null end,
    'latestPayment',(select jsonb_build_object('id',l.id,'date',l.entry_date,'amount',l.credit,'currencyCode',l.currency_code,'referenceId',l.reference_id)
      from public.customer_ledger_entries l where l.organization_id=p_organization_id and l.branch_id=p_branch_id
        and l.customer_id=p_customer_id and l.entry_type='PAYMENT' order by l.entry_date desc,l.id desc limit 1)
  ) into result;
  return result;
end $$;

create or replace function public.search_vendors_fuzzy(
  p_user_id uuid,p_organization_id uuid,p_branch_id uuid,p_query text,p_limit integer default 10
) returns table(id bigint,name text,confidence real,match_kind text)
language plpgsql stable security invoker set search_path='' set pg_trgm.word_similarity_threshold='0.45' set statement_timeout='3000ms' as $$
declare q text := private.entity_search_normalize(p_query); anchor text;
begin
  if not coalesce(public.has_permission_for_user(p_user_id,p_organization_id,'vendors.read'),false)
     or not coalesce(public.has_branch_access_for_user(p_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501',message='Authorized vendor scope required';
  end if;
  if p_query is null or length(p_query)>120 or length(q)<2 then return; end if;
  select token into anchor from unnest(string_to_array(q,' ')) token order by length(token) desc,token limit 1;
  return query with scored as (
    select v.id,v.name::text,
      case when private.entity_search_normalize(v.name)=q then 1.0::real else private.entity_search_score(q,private.entity_search_normalize(v.name)) end confidence,
      case when private.entity_search_normalize(v.name)=q then 'exact_name' else 'fuzzy' end match_kind
    from public.vendors v where v.organization_id=p_organization_id
      and private.entity_search_normalize(v.name) operator(extensions.%>) anchor
  ) select s.* from scored s where s.confidence>=0.65 order by s.confidence desc,s.id
    limit greatest(2,least(coalesce(p_limit,10),20));
end $$;
revoke all on function public.copilot_customer_ledger(uuid,uuid,uuid,bigint,integer,bigint) from public,anon,authenticated;
revoke all on function public.search_vendors_fuzzy(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.copilot_customer_ledger(uuid,uuid,uuid,bigint,integer,bigint) to service_role;
grant execute on function public.search_vendors_fuzzy(uuid,uuid,uuid,text,integer) to service_role;
