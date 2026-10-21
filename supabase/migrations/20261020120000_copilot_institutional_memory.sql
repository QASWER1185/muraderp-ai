-- Durable commercial facts come directly from ERP records. Only reviewed slip
-- translations and explicit merchant wholesale ceilings need independent storage.
alter table public.ai_copilot_actions drop constraint ai_copilot_actions_intent_check;
alter table public.ai_copilot_actions add constraint ai_copilot_actions_intent_check check(intent in (
  'estimate','invoice','customer_return','supplier_bill','inventory_adjustment','customer_create','vendor_create',
  'rate_list_update','customer_payment','vendor_payment','customer_update','product_price_update','estimate_convert_invoice'
));
alter table public.invoice_items add column gross_unit_price numeric check(gross_unit_price >= 0);
alter table public.invoice_items add column customer_discount_percent numeric check(customer_discount_percent between 0 and 100);
alter table public.invoice_items add column customer_discount_amount numeric check(customer_discount_amount>=0 and customer_discount_amount<=line_total);

-- Native estimate conversion also snapshots line terms at the instant of sale.
-- Later edits to a source estimate cannot rewrite the return entitlement.
create function private.snapshot_invoice_commercial_terms()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_invoice public.invoices%rowtype; v_line public.estimate_items%rowtype;
begin
  if new.customer_discount_amount is not null then return new; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id;
  if v_invoice.source_estimate_id is not null then
    select * into v_line from public.estimate_items ei
      where ei.estimate_id=v_invoice.source_estimate_id and ei.line_number=new.line_number
        and ei.product_id=new.product_id and ei.quantity=new.quantity and ei.unit=new.unit and ei.unit_price=new.unit_price;
    if found and v_invoice.discount_total=(select sum(ei.discount_amount) from public.estimate_items ei where ei.estimate_id=v_invoice.source_estimate_id) then
      new.gross_unit_price:=new.unit_price;
      new.customer_discount_amount:=v_line.discount_amount;
      new.customer_discount_percent:=case when new.line_total=0 then 0 else v_line.discount_amount/new.line_total*100 end;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_invoice_commercial_terms() from public,anon,authenticated;
create trigger snapshot_invoice_commercial_terms before insert on public.invoice_items
  for each row execute function private.snapshot_invoice_commercial_terms();

create function private.copilot_invoice_net_rate(p_item_id bigint)
returns numeric language sql stable security definer set search_path='' as $$
  select case
    when ii.customer_discount_amount is not null then (ii.line_total-ii.customer_discount_amount)/ii.quantity
    -- Legacy invoices store gross lines and a header discount. If lines already
    -- sum to the net grand total, do not apply that discount a second time.
    when i.discount_total > 0 and i.subtotal > 0
      and (select sum(x.line_total) from public.invoice_items x where x.invoice_id=i.id)=i.subtotal
      then ii.unit_price * (i.grand_total / i.subtotal)
    else ii.unit_price end
  from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id where ii.id=p_item_id;
$$;
revoke all on function private.copilot_invoice_net_rate(bigint) from public,anon,authenticated;
grant execute on function private.copilot_invoice_net_rate(bigint) to service_role;

create view public.copilot_commercial_history with (security_invoker=true) as
select i.organization_id,i.branch_id,i.customer_id,ii.product_id,p.name as product_name,
  p.brand_id,b.name as brand_name,p.category,ii.unit,ii.quantity,
  coalesce(ii.gross_unit_price,ii.unit_price) as unit_price,
  coalesce(ii.customer_discount_percent,case when ii.unit_price=0 then 0 else
    (1-private.copilot_invoice_net_rate(ii.id)/ii.unit_price)*100 end) as discount_percent,
  private.copilot_invoice_net_rate(ii.id) as net_unit_price,
  i.issue_date as invoice_date,i.id as document_id,i.invoice_number as document_number,
  'invoice'::text as document_type,ii.id as source_item_id,i.currency_code
from public.invoices i join public.invoice_items ii on ii.invoice_id=i.id
join public.products p on p.id=ii.product_id and p.organization_id=i.organization_id
left join public.brands b on b.id=p.brand_id and b.organization_id=i.organization_id
where i.status in ('POSTED','PARTIALLY_PAID','PAID')
union all
select e.organization_id,e.branch_id,e.customer_id,ei.product_id,p.name,p.brand_id,b.name,p.category,
  ei.unit,ei.quantity,ei.unit_price,
  case when ei.quantity*ei.unit_price=0 then 0 else ei.discount_amount/(ei.quantity*ei.unit_price)*100 end,
  (ei.quantity*ei.unit_price-ei.discount_amount)/ei.quantity,
  e.issue_date,e.id,e.estimate_number,'estimate'::text,ei.id,e.currency_code
from public.estimates e join public.estimate_items ei on ei.estimate_id=e.id
join public.products p on p.id=ei.product_id and p.organization_id=e.organization_id
left join public.brands b on b.id=p.brand_id and b.organization_id=e.organization_id
where e.status in ('DRAFT','READY')
  and not exists(select 1 from public.invoices i where i.source_estimate_id=e.id and i.status in ('POSTED','PARTIALLY_PAID','PAID'));
revoke all on public.copilot_commercial_history from public,anon,authenticated;
grant select on public.copilot_commercial_history to service_role;
create index copilot_invoice_customer_history on public.invoices(organization_id,branch_id,customer_id,issue_date desc,id desc);

create table public.copilot_purchase_baselines (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  brand_id bigint not null references public.brands(id), category text not null,
  wholesale_discount_percent numeric not null check(wholesale_discount_percent between 0 and 100),
  currency_code text not null default 'PKR', unit text not null,
  effective_from timestamptz not null default now(), effective_to timestamptz,
  check(effective_to is null or effective_to>effective_from),
  unique(organization_id,brand_id,category,currency_code,unit,effective_from)
);
alter table public.copilot_purchase_baselines enable row level security;
alter table public.copilot_purchase_baselines force row level security;
revoke all on public.copilot_purchase_baselines from public,anon,authenticated;
grant select,insert,update,delete on public.copilot_purchase_baselines to service_role;
grant usage,select on sequence public.copilot_purchase_baselines_id_seq to service_role;

create function public.copilot_purchase_floor(p_organization_id uuid,p_product_id bigint,p_list_price numeric,p_unit text,p_currency text)
returns numeric language sql stable security invoker set search_path='' as $$
  select max(cost) from (
    select p.purchase_price as cost from public.products p
      where p.id=p_product_id and p.organization_id=p_organization_id and p.unit=p_unit and p_currency='PKR'
    union all
    select recent.cost from (
      select pi.unit_cost * case when pu.subtotal>0 then pu.total/pu.subtotal else 1 end as cost
      from public.purchase_items pi join public.purchases pu on pu.id=pi.purchase_id
      join public.products p on p.id=pi.product_id
      where pi.product_id=p_product_id and pi.organization_id=p_organization_id and pu.organization_id=p_organization_id
        and p.organization_id=p_organization_id and p.unit=p_unit and p_currency='PKR'
      order by pu.purchase_date desc,pu.id desc,pi.id desc limit 1
    ) recent
    union all
    select p_list_price*(1-b.wholesale_discount_percent/100)
      from public.copilot_purchase_baselines b join public.products p on p.brand_id=b.brand_id and p.category=b.category
      where p.id=p_product_id and p.organization_id=p_organization_id and b.organization_id=p_organization_id
        and b.currency_code=p_currency and b.unit=p_unit and b.effective_from<=now() and (b.effective_to is null or b.effective_to>now())
    union all
    select rli.unit_price from public.rate_list_items rli join public.rate_list_versions rlv on rlv.id=rli.rate_list_version_id
      join public.rate_lists rl on rl.id=rlv.rate_list_id
      where rl.organization_id=p_organization_id and rl.price_type='PURCHASE' and rl.is_active and rlv.status='ACTIVE'
        and rlv.effective_from<=now() and (rlv.effective_to is null or rlv.effective_to>now())
        and rli.product_id=p_product_id and rli.unit=p_unit and rl.currency_code=p_currency and rli.minimum_quantity<=1
  ) floors;
$$;
revoke all on function public.copilot_purchase_floor(uuid,bigint,numeric,text,text) from public,anon,authenticated;
grant execute on function public.copilot_purchase_floor(uuid,bigint,numeric,text,text) to service_role;

create table public.copilot_slip_patterns (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  raw_shorthand text not null check(length(raw_shorthand) between 1 and 200),
  verified_item_name text not null check(length(verified_item_name) between 1 and 200),
  verified_size text not null check(length(verified_size)<=100), verified_unit text not null check(length(verified_unit) between 1 and 50),
  usage_count bigint not null default 1 check(usage_count>0), last_confirmed_at timestamptz not null default now(),
  unique(organization_id,raw_shorthand,verified_item_name,verified_size,verified_unit)
);
create table public.copilot_slip_learning_events (
  action_id uuid primary key references public.ai_copilot_actions(id),
  organization_id uuid not null references public.organizations(id), fingerprint text not null
);
alter table public.copilot_slip_patterns enable row level security;
alter table public.copilot_slip_patterns force row level security;
alter table public.copilot_slip_learning_events enable row level security;
alter table public.copilot_slip_learning_events force row level security;
revoke all on public.copilot_slip_patterns,public.copilot_slip_learning_events from public,anon,authenticated;
grant select,insert,update on public.copilot_slip_patterns,public.copilot_slip_learning_events to service_role;
grant usage,select on sequence public.copilot_slip_patterns_id_seq to service_role;

create function public.learn_confirmed_copilot_slip(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_action_id uuid,p_patterns jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_action public.ai_copilot_actions%rowtype; v_fingerprint text:=md5(p_patterns::text); v_previous text;
begin
  select * into v_action from public.ai_copilot_actions where id=p_action_id for update;
  if not found or v_action.organization_id<>p_organization_id or v_action.user_id<>p_actor_user_id
    or v_action.action_plan->>'branchId' is distinct from p_branch_id::text
    or coalesce(v_action.action_plan->>'source','') not in ('image','camera')
    or v_action.status not in ('CONFIRMED','EXECUTED') or v_action.result is null then
    raise exception using errcode='42501',message='Only a confirmed scoped slip with a persisted ERP result may teach memory';
  end if;
  if jsonb_typeof(p_patterns)<>'array' or jsonb_array_length(p_patterns)>500 then
    raise exception using errcode='22023',message='Invalid confirmed slip patterns';
  end if;
  select fingerprint into v_previous from public.copilot_slip_learning_events where action_id=p_action_id;
  if found then
    if v_previous<>v_fingerprint then raise exception using errcode='22023',message='Learning replay differs'; end if;
    return;
  end if;
  insert into public.copilot_slip_patterns(organization_id,raw_shorthand,verified_item_name,verified_size,verified_unit)
    select distinct p_organization_id,lower(btrim(x.raw_shorthand)),btrim(x.verified_item_name),btrim(x.verified_size),btrim(x.verified_unit)
    from jsonb_to_recordset(p_patterns) x(raw_shorthand text,verified_item_name text,verified_size text,verified_unit text)
    on conflict(organization_id,raw_shorthand,verified_item_name,verified_size,verified_unit)
    do update set usage_count=public.copilot_slip_patterns.usage_count+1,last_confirmed_at=now();
  insert into public.copilot_slip_learning_events values(p_action_id,p_organization_id,v_fingerprint);
end;
$$;
revoke all on function public.learn_confirmed_copilot_slip(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.learn_confirmed_copilot_slip(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- The unified action prerequisite references this adapter. Delegate accounting,
-- stock, branch access and receipt posting to the existing authoritative RPCs in
-- the same transaction and retain exact per-line commercial terms for returns.
create function public.commit_copilot_sale(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,
  p_service_principal text,p_idempotency_key text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb; v_receipt jsonb; v_item jsonb; v_floor numeric; v_discount numeric;
  v_total_discount numeric:=0; v_fingerprint text:=repeat(md5(p_payload::text),2);
begin
  for v_item in select value from jsonb_array_elements(p_payload->'lines') loop
    v_discount:=(v_item->>'customer_discount_amount')::numeric;
    if v_discount is null or v_discount<0 or v_discount>(v_item->>'line_total')::numeric then
      raise exception using errcode='22023',message='Exact approved line discount is required';
    end if;
    if (v_item->>'gross_unit_price')::numeric is distinct from (v_item->>'unit_price')::numeric then
      raise exception using errcode='22023',message='Gross rate must equal the billed list rate';
    end if;
    v_total_discount:=v_total_discount+v_discount;
    v_floor:=public.copilot_purchase_floor(p_organization_id,(v_item->>'product_id')::bigint,
      (v_item->>'unit_price')::numeric,v_item->>'unit',p_payload->'invoice'->>'currency_code');
    if v_floor is null and v_item->>'unit_cost' is null then
      raise exception using errcode='22023',message='A merchant cost floor is required';
    end if;
    if ((v_item->>'line_total')::numeric-v_discount)/(v_item->>'quantity')::numeric < greatest(v_floor,(v_item->>'unit_cost')::numeric) then
      raise exception using errcode='22023',message='Customer discount exceeds merchant cost floor';
    end if;
  end loop;
  if v_total_discount is distinct from (p_payload->'invoice'->>'discount_total')::numeric then
    raise exception using errcode='22023',message='Line discounts must equal the approved invoice discount';
  end if;
  v_result:=public.post_invoice_atomic(p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,
    'sales.invoice.post',p_idempotency_key,v_fingerprint,p_payload->'invoice',p_payload->'lines',(p_payload->>'warehouseId')::bigint);
  update public.invoice_items ii set gross_unit_price=(x->>'gross_unit_price')::numeric,
    customer_discount_percent=(x->>'customer_discount_percent')::numeric,customer_discount_amount=(x->>'customer_discount_amount')::numeric
    from jsonb_array_elements(p_payload->'lines') x
    where ii.invoice_id=(v_result->>'invoice_id')::bigint and ii.line_number=(x->>'line_number')::integer;
  if coalesce((p_payload->>'paidAmount')::numeric,0)>0 then
    v_receipt:=public.record_customer_payment(p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,'customer-payment.create',
      (p_payload->'invoice'->>'customer_id')::bigint,(p_payload->'invoice'->>'issue_date')::date,(p_payload->>'paidAmount')::numeric,
      p_payload->'invoice'->>'currency_code','CASH',null,'Copilot invoice receipt',
      jsonb_build_array(jsonb_build_object('invoice_id',(v_result->>'invoice_id')::bigint,'amount',(p_payload->>'paidAmount')::numeric)),
      p_idempotency_key||'-receipt',v_fingerprint);
    v_result:=v_result||jsonb_build_object('payment_id',v_receipt->'payment'->'id');
  end if;
  return v_result;
end;
$$;
revoke all on function public.commit_copilot_sale(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_copilot_sale(uuid,uuid,uuid,text,text,jsonb) to service_role;

-- Preserve return locks, authorization, idempotency and journals; bind both totals and lines to historical net.
create or replace function public.record_sales_return(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_credit_note_number text,
  p_invoice_id bigint,
  p_customer_id bigint,
  p_credit_date date,
  p_currency_code text,
  p_reason text,
  p_notes text,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_credit_note_id bigint;
  v_journal_entry_id uuid;
  v_existing record;
  v_item record;
  v_invoice record;
  v_item_count integer;
  v_distinct_item_count integer;
  v_returned numeric;
  v_subtotal numeric := 0;
  v_cogs numeric := 0;
  v_inventory_organization uuid;
  v_inventory_found boolean;
  v_result jsonb;
  v_ar_account uuid;
  v_inventory_account uuid;
  v_sales_account uuid;
  v_cogs_account uuid;
begin
  perform private.assert_authoritative_non_sales_context(
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, 'sales-return.create', 'returns.create'
  );

  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255 then
    raise exception using errcode='22023', message='A valid Idempotency-Key is required';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='A valid request fingerprint is required';
  end if;
  if nullif(btrim(p_credit_note_number),'') is null or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023', message='Credit note number and reason are required';
  end if;
  if nullif(btrim(p_currency_code),'') is null then
    raise exception using errcode='22023', message='currency_code is required';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception using errcode='22023', message='At least one return item is required';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id=p_customer_id and c.organization_id=p_organization_id
  ) then
    raise exception using errcode='42501', message='customer ownership is not assigned to the authorized organization';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id=p_invoice_id
  for update;
  if not found
     or v_invoice.customer_id is distinct from p_customer_id
     or v_invoice.organization_id is distinct from p_organization_id
     or v_invoice.branch_id is distinct from p_branch_id then
    raise exception using errcode='42501', message='invoice is outside the authorized customer, organization, or branch';
  end if;
  if v_invoice.status='VOID' then
    raise exception using errcode='22023', message='Cannot return items from a void invoice';
  end if;
  if upper(btrim(p_currency_code)) is distinct from upper(btrim(v_invoice.currency_code)) then
    raise exception using errcode='22023', message='Credit note currency must match the invoice currency';
  end if;

  select count(*), count(distinct item.invoice_item_id)
    into v_item_count, v_distinct_item_count
  from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric);
  if v_item_count <> jsonb_array_length(p_items)
     or v_item_count <> v_distinct_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
       where item.invoice_item_id is null or item.warehouse_id is null
          or item.quantity is null or item.quantity <= 0
     ) then
    raise exception using errcode='22023', message='Each invoice item may appear once with a warehouse and positive quantity';
  end if;

  perform ii.id
  from public.invoice_items ii
  where ii.id in (
    select item.invoice_item_id
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
  )
  order by ii.id
  for update;

  if (
    select count(*)
    from public.invoice_items ii
    join jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
      on item.invoice_item_id=ii.id
    where ii.invoice_id=p_invoice_id
  ) <> v_distinct_item_count then
    raise exception using errcode='42501', message='one or more invoice items are outside the authorized invoice';
  end if;

  -- Complete every ownership check before creating an idempotency or business row.
  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit_cost
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    if not exists (
      select 1 from public.products p
      where p.id=v_item.product_id and p.organization_id=p_organization_id
    ) then
      raise exception using errcode='42501', message='product ownership is not assigned to the authorized organization';
    end if;
    if not exists (
      select 1 from public.warehouses w
      where w.id=v_item.warehouse_id and w.organization_id=p_organization_id
    ) then
      raise exception using errcode='42501', message='return warehouse ownership is not assigned to the authorized organization';
    end if;
    if v_item.unit_cost is null then
      raise exception using errcode='22023', message='Invoice item is missing unit cost; inventory reversal is unsafe';
    end if;

    v_inventory_found := false;
    select i.organization_id, true
      into v_inventory_organization, v_inventory_found
    from public.inventory i
    where i.product_id=v_item.product_id and i.warehouse_id=v_item.warehouse_id
    for update;
    if v_inventory_found and v_inventory_organization is distinct from p_organization_id then
      raise exception using errcode='42501', message='inventory ownership is not assigned to the authorized organization';
    end if;
  end loop;

  select a.id into v_ar_account from public.accounts a where a.code='1100' and a.is_active;
  select a.id into v_inventory_account from public.accounts a where a.code='1200' and a.is_active;
  select a.id into v_sales_account from public.accounts a where a.code='4000' and a.is_active;
  select a.id into v_cogs_account from public.accounts a where a.code='5000' and a.is_active;
  if v_ar_account is null or v_inventory_account is null or v_sales_account is null or v_cogs_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for sales return posting';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_organization_id,p_service_principal,p_operation_scope,p_idempotency_key)::text,
      0
    )
  );

  select * into v_existing
  from public.credit_note_idempotency_keys k
  where k.organization_id=p_organization_id
    and k.principal_scope=p_service_principal
    and k.operation=p_operation_scope
    and k.idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.branch_id is distinct from p_branch_id then
      raise exception using errcode='P0001', message='Idempotency-Key was reused for a different sales return request';
    end if;
    if v_existing.credit_note_id is null then
      raise exception using errcode='P0003', message='Sales return idempotency request is already being processed';
    end if;
    if v_existing.journal_entry_id is null
       or not exists (
         select 1 from public.journal_entries je
         where je.id=v_existing.journal_entry_id
           and je.organization_id=p_organization_id
           and je.branch_id=p_branch_id
           and je.source_type='CREDIT_NOTE'
           and je.source_record_id=v_existing.credit_note_id::text
           and je.posting_kind='PRIMARY'
           and je.status='POSTED'
       ) then
      raise exception using errcode='23514', message='idempotent sales return replay is missing its authoritative posted journal';
    end if;
    select jsonb_build_object(
      'credit_note',to_jsonb(cn),
      'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)
    ) into v_result
    from public.credit_notes cn
    where cn.id=v_existing.credit_note_id and cn.organization_id=p_organization_id and cn.branch_id=p_branch_id;
    return v_result;
  end if;

  insert into public.credit_note_idempotency_keys(
    organization_id, branch_id, actor_user_id, principal_scope, operation,
    idempotency_key, request_fingerprint
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),
    p_operation_scope,btrim(p_idempotency_key),p_request_fingerprint
  );

  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit, private.copilot_invoice_net_rate(ii.id) as unit_price, ii.unit_cost, ii.quantity as sold_quantity
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    select coalesce(sum(ci.quantity),0) into v_returned
    from public.credit_note_items ci
    join public.credit_notes cn on cn.id=ci.credit_note_id
    where ci.invoice_item_id=v_item.invoice_item_id and cn.status='POSTED';
    if v_returned + v_item.quantity > v_item.sold_quantity then
      raise exception using errcode='P0002', message='Return quantity exceeds the remaining invoice quantity';
    end if;
    v_subtotal := v_subtotal + (v_item.quantity * v_item.unit_price);
    v_cogs := v_cogs + (v_item.quantity * v_item.unit_cost);
  end loop;
  if v_subtotal + v_cogs <= 0 then
    raise exception using errcode='22023', message='A posted sales return must have a non-zero accounting effect';
  end if;

  insert into public.credit_notes(
    organization_id,branch_id,actor_user_id,service_principal,operation_scope,
    credit_note_number,invoice_id,customer_id,credit_date,currency_code,status,
    subtotal,grand_total,reason,notes
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),p_operation_scope,
    btrim(p_credit_note_number),p_invoice_id,p_customer_id,coalesce(p_credit_date,current_date),
    upper(btrim(p_currency_code)),'POSTED',v_subtotal,v_subtotal,btrim(p_reason),nullif(btrim(p_notes),'')
  ) returning id into v_credit_note_id;

  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit, private.copilot_invoice_net_rate(ii.id) as unit_price, ii.unit_cost
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    insert into public.credit_note_items(
      organization_id,branch_id,credit_note_id,invoice_item_id,product_id,warehouse_id,
      quantity,unit,unit_price,line_total,unit_cost,cogs_reversal_total
    ) values (
      p_organization_id,p_branch_id,v_credit_note_id,v_item.invoice_item_id,v_item.product_id,
      v_item.warehouse_id,v_item.quantity,v_item.unit,v_item.unit_price,
      v_item.quantity*v_item.unit_price,v_item.unit_cost,v_item.quantity*v_item.unit_cost
    );
    insert into public.stock_movements(
      organization_id,branch_id,product_id,warehouse_id,movement_type,quantity,
      reference_type,reference_id,unit_cost,notes
    ) values (
      p_organization_id,p_branch_id,v_item.product_id,v_item.warehouse_id,'SALE_RETURN',
      v_item.quantity,'CREDIT_NOTE',v_credit_note_id,v_item.unit_cost,'Sales return / credit note'
    );
    insert into public.inventory as inventory_balance(organization_id,product_id,warehouse_id,quantity)
    values (p_organization_id,v_item.product_id,v_item.warehouse_id,v_item.quantity)
    on conflict(product_id,warehouse_id) do update
      set quantity=inventory_balance.quantity+excluded.quantity,updated_at=now()
      where inventory_balance.organization_id=excluded.organization_id;
  end loop;

  insert into public.customer_ledger_entries(
    organization_id,branch_id,customer_id,entry_type,reference_type,reference_id,
    debit,credit,currency_code,entry_date,description
  ) values (
    p_organization_id,p_branch_id,p_customer_id,'CREDIT_NOTE','CREDIT_NOTE',v_credit_note_id,
    0,v_subtotal,upper(btrim(p_currency_code)),coalesce(p_credit_date,current_date),'Sales return credit note'
  );

  insert into public.journal_entries(
    organization_id,branch_id,actor_user_id,entry_date,description,source_type,
    source_id,source_record_id,posting_kind,principal_scope,operation_scope,
    idempotency_key,request_fingerprint,status
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,coalesce(p_credit_date,current_date),
    'Sales return '||btrim(p_credit_note_number),'CREDIT_NOTE',null,v_credit_note_id::text,
    'PRIMARY',btrim(p_service_principal),p_operation_scope,btrim(p_idempotency_key),
    p_request_fingerprint,'DRAFT'
  ) returning id into v_journal_entry_id;
  if v_subtotal > 0 then
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_journal_entry_id,v_sales_account,v_subtotal,0,'Reverse product sales revenue'),
      (v_journal_entry_id,v_ar_account,0,v_subtotal,'Customer receivable credit');
  end if;
  if v_cogs > 0 then
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_journal_entry_id,v_inventory_account,v_cogs,0,'Inventory restored'),
      (v_journal_entry_id,v_cogs_account,0,v_cogs,'Reverse cost of goods sold');
  end if;
  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries set status='POSTED' where id=v_journal_entry_id;

  update public.credit_note_idempotency_keys
  set credit_note_id=v_credit_note_id,journal_entry_id=v_journal_entry_id
  where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
    and operation=p_operation_scope and idempotency_key=btrim(p_idempotency_key);

  select jsonb_build_object(
    'credit_note',to_jsonb(cn),
    'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)
  ) into v_result
  from public.credit_notes cn where cn.id=v_credit_note_id;
  return v_result;
end;
$$;
