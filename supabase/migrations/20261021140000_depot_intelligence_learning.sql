alter table public.customers add column if not exists credit_limit numeric(20,4) not null default 0 check(credit_limit>=0);

create table public.companion_learning_events(
  organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  estimate_id bigint not null references public.estimates(id),trigger_product_id bigint not null references public.products(id),
  companion_product_id bigint not null references public.products(id),created_at timestamptz not null default now(),
  primary key(estimate_id,trigger_product_id,companion_product_id),check(trigger_product_id<>companion_product_id)
);
alter table public.companion_learning_events enable row level security;
alter table public.companion_learning_events force row level security;
revoke all on public.companion_learning_events from public,anon,authenticated;
grant select,insert on public.companion_learning_events to service_role;
create function private.learn_estimate_companions() returns trigger language plpgsql security definer set search_path='' as $$
declare v_estimate public.estimates%rowtype;
begin
  select * into v_estimate from public.estimates where id=new.estimate_id;
  if v_estimate.organization_id is null or v_estimate.branch_id is null then return new; end if;
  insert into public.companion_learning_events(organization_id,branch_id,estimate_id,trigger_product_id,companion_product_id)
    select v_estimate.organization_id,v_estimate.branch_id,new.estimate_id,new.product_id,i.product_id
      from public.estimate_items i where i.estimate_id=new.estimate_id and i.product_id<>new.product_id
    union
    select v_estimate.organization_id,v_estimate.branch_id,new.estimate_id,i.product_id,new.product_id
      from public.estimate_items i where i.estimate_id=new.estimate_id and i.product_id<>new.product_id
    on conflict do nothing;
  return new;
end $$;
revoke all on function private.learn_estimate_companions() from public,anon,authenticated;
create trigger estimate_companion_learning after insert on public.estimate_items for each row execute function private.learn_estimate_companions();
create index companion_learning_scope on public.companion_learning_events(organization_id,branch_id,trigger_product_id,companion_product_id);

create function public.depot_companion_suggestions(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_product_ids bigint[],p_brand text default null)
returns table(product_id bigint,name text,unit text,usage_count bigint) language plpgsql stable security invoker set search_path='' as $$
begin
  perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'sales.read');
  perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'products.read');
  if cardinality(p_product_ids)>500 then raise exception using errcode='22023',message='Too many companion anchors'; end if;
  return query
    select p.id,p.name,p.unit,count(distinct e.estimate_id) as usage_count from public.companion_learning_events e
    join public.products p on p.id=e.companion_product_id and p.organization_id=e.organization_id
    left join public.brands b on b.id=p.brand_id and b.organization_id=p.organization_id
    where e.organization_id=p_organization_id and e.branch_id=p_branch_id and e.trigger_product_id=any(p_product_ids)
      and exists(select 1 from public.estimates est where est.id=e.estimate_id and est.organization_id=p_organization_id and est.branch_id=p_branch_id and est.status<>'CANCELLED')
      and exists(select 1 from public.estimate_items current_item where current_item.estimate_id=e.estimate_id and current_item.product_id=e.trigger_product_id)
      and exists(select 1 from public.estimate_items current_item where current_item.estimate_id=e.estimate_id and current_item.product_id=e.companion_product_id)
      and not p.id=any(p_product_ids) and (p_brand is null or lower(btrim(b.name))=lower(btrim(p_brand)))
      and exists(select 1 from public.rate_list_items i join public.rate_list_versions v on v.id=i.rate_list_version_id
        join public.rate_lists l on l.id=v.rate_list_id where i.product_id=p.id and l.organization_id=p_organization_id
        and l.price_type='SALE' and l.is_active and v.status='ACTIVE' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now()))
    group by p.id,p.name,p.unit having count(distinct e.estimate_id)>=3 order by usage_count desc,p.id limit 5;
end $$;
revoke all on function public.depot_companion_suggestions(uuid,uuid,uuid,bigint[],text) from public,anon,authenticated;
grant execute on function public.depot_companion_suggestions(uuid,uuid,uuid,bigint[],text) to service_role;
create function public.depot_private_purchase_floor(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_product_id bigint,p_list_price numeric,p_unit text,p_currency text)
returns numeric language plpgsql stable security invoker set search_path='' as $$
begin
  perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'purchases.read');
  return public.copilot_purchase_floor(p_organization_id,p_product_id,p_list_price,p_unit,p_currency);
end $$;
revoke all on function public.depot_private_purchase_floor(uuid,uuid,uuid,bigint,numeric,text,text) from public,anon,authenticated;
grant execute on function public.depot_private_purchase_floor(uuid,uuid,uuid,bigint,numeric,text,text) to service_role;

create function public.depot_intelligence_report(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_request jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='10000ms' as $$
declare
  v_report text:=p_request->>'report';v_from date:=coalesce((p_request->>'from')::date,date_trunc('month',current_date)::date);
  v_to date:=coalesce((p_request->>'to')::date,current_date);v_result jsonb;v_customer public.customers%rowtype;
  v_balance numeric;v_last date;v_first date;v_warnings jsonb:='[]'::jsonb;
begin
  if v_from>v_to or v_to-v_from>1826 then raise exception using errcode='22023',message='Report date range invalid'; end if;
  if v_report='credit_guard' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'customers.read');
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'accounting.read');
    select * into strict v_customer from public.customers where id=(p_request->>'customerId')::bigint and organization_id=p_organization_id;
    select coalesce(sum(debit-credit),0),min(entry_date) filter(where debit>0) into v_balance,v_first from public.customer_ledger_entries
      where organization_id=p_organization_id and branch_id=p_branch_id and customer_id=v_customer.id and currency_code='PKR' and entry_date<=v_to;
    select max(payment_date) into v_last from public.customer_payments where organization_id=p_organization_id and branch_id=p_branch_id and customer_id=v_customer.id and payment_date<=v_to;
    if v_customer.credit_limit>0 and v_balance>v_customer.credit_limit then v_warnings:=v_warnings||jsonb_build_array('حاجی صاحب، اس گاہک کا بقایا مقررہ کریڈٹ حد سے زیادہ ہے۔ ایسٹیمیٹ سے پہلے وصولی کی صورت واضح کر لیں۔'); end if;
    if v_balance>0 and coalesce(v_last,v_first)<=v_to-30 then v_warnings:=v_warnings||jsonb_build_array('اس گاہک کی ادائیگی کو 30 دن سے زیادہ ہو گئے ہیں؛ وصولی کی یاد دہانی مناسب رہے گی۔'); end if;
    return jsonb_build_object('customer',v_customer.name,'outstanding',v_balance,'currency','PKR','creditLimit',v_customer.credit_limit,'lastPayment',v_last,'warnings',v_warnings);
  end if;
  perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'reports.view');
  if v_report='accounts' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'accounting.read');
    select coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'type',account_type) order by code),'[]') into v_result from public.accounts where is_active;
  elsif v_report='top_sellers' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'sales.read');
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_result from (
      select p.id as product_id,p.name,ii.unit,sum(ii.quantity) as quantity,sum(ii.quantity*private.copilot_invoice_net_rate(ii.id)) as net_sales
      from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id join public.products p on p.id=ii.product_id
      where i.organization_id=p_organization_id and i.branch_id=p_branch_id and i.status in('POSTED','PAID','PARTIALLY_PAID')
        and i.issue_date between v_from and v_to group by p.id,p.name,ii.unit order by quantity desc,p.id limit 50
    ) r;
  elsif v_report='customer_profitability' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'sales.read');
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'purchases.read');
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_result from (
      with sales as (
        select i.customer_id,sum(i.grand_total) as revenue,sum((select coalesce(sum(ii.cogs_total),0) from public.invoice_items ii where ii.invoice_id=i.id)) as cost
        from public.invoices i where i.organization_id=p_organization_id and i.branch_id=p_branch_id and i.status in('POSTED','PAID','PARTIALLY_PAID')
          and i.issue_date between v_from and v_to group by i.customer_id
      ), credits as (
        select n.customer_id,sum(n.grand_total) as returned,sum((select coalesce(sum(ci.cogs_reversal_total),0) from public.credit_note_items ci where ci.credit_note_id=n.id)) as reversed_cost
        from public.credit_notes n where n.organization_id=p_organization_id and n.branch_id=p_branch_id and n.status='POSTED' and n.credit_date between v_from and v_to group by n.customer_id
      )
      select c.id as customer_id,c.name,coalesce(s.revenue,0)-coalesce(r.returned,0) as net_sales,
        coalesce(s.revenue,0)-coalesce(s.cost,0)-coalesce(r.returned,0)+coalesce(r.reversed_cost,0) as gross_profit
      from public.customers c left join sales s on s.customer_id=c.id left join credits r on r.customer_id=c.id
      where c.organization_id=p_organization_id and (s.customer_id is not null or r.customer_id is not null) order by gross_profit desc,c.id
    ) r;
  elsif v_report='reorder_deadstock' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'inventory.read');
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'sales.read');
    select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_result from (
      with stock as(select product_id,sum(quantity) as on_hand from public.inventory where organization_id=p_organization_id group by product_id),
      sales as(select ii.product_id,max(i.issue_date) as last_sale,sum(ii.quantity) filter(where i.issue_date>v_to-30) as recent_quantity
        from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where i.organization_id=p_organization_id and i.branch_id=p_branch_id
        and i.status in('POSTED','PAID','PARTIALLY_PAID') and i.issue_date<=v_to group by ii.product_id)
      select p.id as product_id,p.name,p.unit,s.on_hand,x.last_sale,
        s.on_hand>0 and coalesce(x.last_sale,p.created_at::date)<=v_to-60 as dead_stock,
        s.on_hand<=coalesce(x.recent_quantity,0)/30*7 and coalesce(x.recent_quantity,0)>0 as reorder,
        'organization warehouse stock; branch sales velocity' as scope
      from public.products p join stock s on s.product_id=p.id left join sales x on x.product_id=p.id where p.organization_id=p_organization_id
    ) r where r.dead_stock or r.reorder;
  elsif v_report='closing' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'accounting.read');
    select jsonb_build_object(
      'cashAndBank',coalesce((select sum(debit-credit) from public.general_ledger where organization_id=p_organization_id and branch_id=p_branch_id and code in('1000','1010','1090') and entry_date<=v_to),0),
      'cashReceipts',coalesce((select sum(debit) from public.general_ledger where organization_id=p_organization_id and branch_id=p_branch_id and code in('1000','1010','1090') and entry_date between v_from and v_to),0),
      'cashPayments',coalesce((select sum(credit) from public.general_ledger where organization_id=p_organization_id and branch_id=p_branch_id and code in('1000','1010','1090') and entry_date between v_from and v_to),0),
      'udhaar',coalesce((select jsonb_agg(to_jsonb(b)) from (
        select customer_id,currency_code,sum(debit-credit) as balance from public.customer_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and entry_date<=v_to group by customer_id,currency_code having sum(debit-credit)<>0
      ) b),'[]'::jsonb)) into v_result;
  elsif v_report='salesman_roi' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'accounting.read');
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'sales.read');
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'purchases.read');
    select jsonb_build_object('salespeople',coalesce((select jsonb_agg(to_jsonb(r)) from (
      select s.id,s.name,
        coalesce((select sum(i.grand_total-(select coalesce(sum(ii.cogs_total),0) from public.invoice_items ii where ii.invoice_id=i.id))
          from public.invoices i where i.organization_id=p_organization_id and i.branch_id=p_branch_id and i.salesperson_id=s.id and i.status in('POSTED','PAID','PARTIALLY_PAID') and i.issue_date between v_from and v_to),0)
        -coalesce((select sum(n.grand_total-(select coalesce(sum(ci.cogs_reversal_total),0) from public.credit_note_items ci where ci.credit_note_id=n.id))
          from public.credit_notes n join public.invoices i on i.id=n.invoice_id where n.organization_id=p_organization_id and n.branch_id=p_branch_id and i.salesperson_id=s.id and n.status='POSTED' and n.credit_date between v_from and v_to),0) as gross_profit,
        coalesce((select sum(e.amount) from public.depot_expenses e where e.organization_id=p_organization_id and e.branch_id=p_branch_id and e.salesperson_id=s.id and e.kind='salary' and e.expense_date between v_from and v_to),0) as salary
      from public.salespeople s where s.organization_id=p_organization_id
    ) r),'[]'::jsonb),'expenseLeaks',coalesce((select jsonb_agg(to_jsonb(r)) from (
      select e.expense_account_id,sum(e.amount) filter(where e.expense_date>v_to-7) as last_week,
        sum(e.amount) filter(where e.expense_date between v_to-35 and v_to-7)/4 as prior_weekly_average
      from public.depot_expenses e where e.organization_id=p_organization_id and e.branch_id=p_branch_id and e.expense_date between v_to-35 and v_to group by e.expense_account_id
      having sum(e.amount) filter(where e.expense_date between v_to-35 and v_to-7)>0 and
        sum(e.amount) filter(where e.expense_date>v_to-7)>sum(e.amount) filter(where e.expense_date between v_to-35 and v_to-7)/4*1.5
    ) r),'[]'::jsonb)) into v_result;
  else raise exception using errcode='22023',message='Unknown depot report'; end if;
  return jsonb_build_object('report',v_report,'from',v_from,'to',v_to,'data',v_result);
end $$;
revoke all on function public.depot_intelligence_report(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.depot_intelligence_report(uuid,uuid,uuid,jsonb) to service_role;
