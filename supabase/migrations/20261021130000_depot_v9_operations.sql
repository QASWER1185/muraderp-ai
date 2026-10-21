alter table public.ai_copilot_actions drop constraint ai_copilot_actions_intent_check;
alter table public.ai_copilot_actions add constraint ai_copilot_actions_intent_check check(intent in(
  'estimate','invoice','customer_return','supplier_bill','inventory_adjustment','customer_create','vendor_create',
  'rate_list_update','customer_payment','vendor_payment','customer_update','product_price_update','estimate_convert_invoice','depot_action'
));
create table public.vendor_quote_reviews(
  id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  actor_user_id uuid not null,observations jsonb not null,audit jsonb not null,created_at timestamptz not null default now()
);
create table public.customer_sites(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  customer_id bigint not null references public.customers(id),name text not null check(btrim(name)<>''),address text not null,
  created_at timestamptz not null default now()
);
create unique index customer_sites_identity on public.customer_sites(organization_id,branch_id,customer_id,lower(btrim(name)));
create table public.site_return_memos(
  id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  site_id uuid not null references public.customer_sites(id),customer_id bigint not null references public.customers(id),
  invoice_id bigint not null references public.invoices(id),invoice_item_id bigint not null references public.invoice_items(id),
  product_id bigint not null references public.products(id),quantity numeric not null check(quantity>0),allocated numeric not null default 0 check(allocated>=0 and allocated<=quantity),
  unit text not null,original_net_rate numeric not null check(original_net_rate>=0),original_unit_cost numeric not null check(original_unit_cost>=0),
  status text not null default 'PENDING_PICKUP' check(status in('PENDING_PICKUP','PARTIAL','TRANSFERRED','CANCELLED')),version integer not null default 1,created_at timestamptz not null default now()
);
create table public.site_transfers(
  id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  memo_id uuid not null references public.site_return_memos(id),target_site_id uuid not null references public.customer_sites(id),
  quantity numeric not null check(quantity>0),discount_percent numeric not null check(discount_percent between 0 and 100),
  target_estimate_id bigint not null references public.estimates(id),challan jsonb not null,
  status text not null default 'PLANNED' check(status in('PLANNED','DELIVERED','CANCELLED')),version integer not null default 1,
  credit_note_id bigint references public.credit_notes(id),invoice_id bigint references public.invoices(id),created_at timestamptz not null default now()
);
create table public.dispatch_orders(
  id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  estimate_id bigint not null references public.estimates(id),site_id uuid references public.customer_sites(id),challan jsonb not null,
  status text not null default 'PICKING' check(status in('PICKING','PARTIAL','DISPATCHED','DELIVERED','CANCELLED')),version integer not null default 1,
  invoice_id bigint references public.invoices(id),created_at timestamptz not null default now(),unique(organization_id,branch_id,estimate_id)
);
create table public.dispatch_items(
  dispatch_id uuid not null references public.dispatch_orders(id),organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  line_number integer not null,product_id bigint not null references public.products(id),quantity numeric not null check(quantity>0),unit text not null,
  dispatched numeric not null default 0,delivered numeric not null default 0,
  primary key(dispatch_id,line_number),check(delivered>=0 and delivered<=dispatched and dispatched<=quantity)
);
create table public.dispatch_events(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  dispatch_id uuid not null references public.dispatch_orders(id),actor_user_id uuid not null,event text not null check(event in('DISPATCH','DELIVER')),
  lines jsonb not null,created_at timestamptz not null default now()
);
create table public.depot_expenses(
  id uuid primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  description text not null,amount numeric(20,4) not null check(amount>0),expense_date date not null,kind text not null check(kind in('expense','salary')),
  salesperson_id bigint references public.salespeople(id),journal_entry_id uuid not null references public.journal_entries(id),
  expense_account_id uuid not null references public.accounts(id),cash_account_id uuid not null references public.accounts(id),created_at timestamptz not null default now()
);
create table public.depot_price_changes(
  id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
  actor_user_id uuid not null,product_id bigint not null references public.products(id),old_version_id bigint not null references public.rate_list_versions(id),
  new_version_id bigint not null references public.rate_list_versions(id),old_price numeric not null,new_price numeric not null,reason text not null,created_at timestamptz not null default now()
);
create table public.depot_action_receipts(
  organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),actor_user_id uuid not null,
  tool text not null,idempotency_key text not null,fingerprint text not null,result jsonb not null,created_at timestamptz not null default now(),
  primary key(organization_id,branch_id,actor_user_id,tool,idempotency_key)
);
do $$
declare t text;
begin
  foreach t in array array['vendor_quote_reviews','customer_sites','site_return_memos','site_transfers','dispatch_orders','dispatch_items','dispatch_events','depot_expenses','depot_price_changes','depot_action_receipts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update on public.%I to service_role',t);
  end loop;
end $$;

create function private.depot_authorize(p_user uuid,p_org uuid,p_branch uuid,p_permission text)
returns void language plpgsql stable security invoker set search_path='' as $$
begin
  if not coalesce(public.has_permission_for_user(p_user,p_org,p_permission),false)
    or not coalesce(public.has_branch_access_for_user(p_user,p_org,p_branch),false) then
    raise exception using errcode='42501',message='Depot organization, branch or permission denied';
  end if;
end $$;
revoke all on function private.depot_authorize(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function private.depot_authorize(uuid,uuid,uuid,text) to service_role;

create function private.post_depot_expense(
  p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_principal text,p_expense_id uuid,
  p_date date,p_description text,p_amount numeric,p_expense_account_id uuid,p_expense_code text,
  p_cash_account_id uuid,p_cash_code text,p_idempotency_key text,p_fingerprint text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_journal uuid;
begin
  if not coalesce(public.has_permission_for_user(p_actor_user_id,p_organization_id,'accounting.post'),false)
    or not coalesce(public.has_branch_access_for_user(p_actor_user_id,p_organization_id,p_branch_id),false) then
    raise exception using errcode='42501',message='Expense posting permission denied';
  end if;
  if p_amount<=0 or p_amount::text in('NaN','Infinity','-Infinity') or nullif(btrim(p_description),'') is null then
    raise exception using errcode='22023',message='Expense details invalid';
  end if;
  if not exists(select 1 from public.accounts a where a.id=p_expense_account_id and a.code=p_expense_code and a.account_type='EXPENSE' and a.is_active)
    or not exists(select 1 from public.accounts a where a.id=p_cash_account_id and a.code=p_cash_code and a.account_type='ASSET' and a.is_active) then
    raise exception using errcode='22023',message='Active expense and cash accounts required';
  end if;
  insert into public.journal_entries(organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status)
    values(p_organization_id,p_branch_id,p_actor_user_id,p_date,p_description,'DEPOT_EXPENSE',p_expense_id::text,'PRIMARY',p_principal,'depot.expense.post',p_idempotency_key,repeat(p_fingerprint,2),'DRAFT') returning id into v_journal;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
    (v_journal,p_expense_account_id,p_amount,0,p_description),(v_journal,p_cash_account_id,0,p_amount,p_description);
  perform public.assert_journal_entry_balanced(v_journal);
  update public.journal_entries set status='POSTED' where id=v_journal;
  return v_journal;
end $$;
revoke all on function private.post_depot_expense(uuid,uuid,uuid,text,uuid,date,text,numeric,uuid,text,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.post_depot_expense(uuid,uuid,uuid,text,uuid,date,text,numeric,uuid,text,uuid,text,text,text) to service_role;

create function public.commit_depot_action(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,
  p_service_principal text,p_tool text,p_payload jsonb,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_result jsonb;v_previous public.depot_action_receipts%rowtype;v_fingerprint text:=md5(p_payload::text);
  v_id uuid:=(p_payload->>'id')::uuid;v_site public.customer_sites%rowtype;v_target public.customer_sites%rowtype;
  v_memo public.site_return_memos%rowtype;v_transfer public.site_transfers%rowtype;v_order public.dispatch_orders%rowtype;
  v_invoice public.invoices%rowtype;v_item public.invoice_items%rowtype;v_line jsonb;v_row public.dispatch_items%rowtype;
  v_quantity numeric;v_returned numeric;v_reserved numeric;v_net numeric;v_estimate jsonb;v_snapshot jsonb;v_credit jsonb;v_sale jsonb;
  v_journal uuid;v_expense_account uuid;v_cash_account uuid;v_old public.rate_list_versions%rowtype;v_new bigint;v_list bigint;
  v_price numeric;v_all boolean;v_permission text;v_lines jsonb;
begin
  v_permission:=case when p_tool='erp_create_site' then 'customers.write' when p_tool='erp_prepare_site_return' then 'returns.create'
    when p_tool='erp_log_expense' then 'accounting.post' when p_tool='erp_update_commodity_rates' then 'products.write' else 'sales.create' end;
  perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,v_permission);
  if nullif(btrim(p_service_principal),'') is null or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255 then
    raise exception using errcode='22023',message='Principal and idempotency required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||p_actor_user_id::text||p_tool||p_idempotency_key,0));
  select * into v_previous from public.depot_action_receipts where organization_id=p_organization_id and branch_id=p_branch_id
    and actor_user_id=p_actor_user_id and tool=p_tool and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.fingerprint<>v_fingerprint then raise exception using errcode='23505',message='Depot idempotency conflict'; end if;
    return v_previous.result;
  end if;
  if p_tool='erp_create_site' then
    if not exists(select 1 from public.customers where id=(p_payload->>'customerId')::bigint and organization_id=p_organization_id) then
      raise exception using errcode='42501',message='Site customer mismatch';
    end if;
    insert into public.customer_sites(id,organization_id,branch_id,customer_id,name,address)
      values(v_id,p_organization_id,p_branch_id,(p_payload->>'customerId')::bigint,p_payload->>'name',p_payload->>'address');
    v_result:=jsonb_build_object('id',v_id,'status','CREATED');
  elsif p_tool='erp_prepare_site_return' then
    select * into strict v_site from public.customer_sites where id=(p_payload->>'siteId')::uuid and organization_id=p_organization_id and branch_id=p_branch_id;
    select * into strict v_invoice from public.invoices where id=(p_payload->>'invoiceId')::bigint and organization_id=p_organization_id and branch_id=p_branch_id for update;
    select * into strict v_item from public.invoice_items where id=(p_payload->>'invoiceItemId')::bigint and invoice_id=v_invoice.id for update;
    if v_invoice.customer_id<>v_site.customer_id or v_invoice.status not in('POSTED','PAID','PARTIALLY_PAID') or v_item.unit_cost is null then
      raise exception using errcode='22023',message='Posted source invoice and exact cost required';
    end if;
    v_quantity:=(p_payload->>'quantity')::numeric;
    v_net:=private.copilot_invoice_net_rate(v_item.id);
    select coalesce(sum(ci.quantity),0) into v_returned from public.credit_note_items ci join public.credit_notes cn on cn.id=ci.credit_note_id
      where ci.invoice_item_id=v_item.id and cn.organization_id=p_organization_id and cn.branch_id=p_branch_id and cn.status='POSTED';
    select coalesce(sum(m.quantity-coalesce((select sum(t.quantity) from public.site_transfers t where t.memo_id=m.id and t.status='DELIVERED'),0)),0)
      into v_reserved from public.site_return_memos m where m.invoice_item_id=v_item.id and m.status in('PENDING_PICKUP','PARTIAL');
    if v_quantity<=0 or v_quantity::text in('NaN','Infinity','-Infinity') or v_quantity+v_returned+v_reserved>v_item.quantity
      or v_net is distinct from (p_payload->>'originalNetRate')::numeric or v_item.unit_cost is distinct from (p_payload->>'originalUnitCost')::numeric then
      raise exception using errcode='40001',message='Historical return binding or available quantity changed';
    end if;
    insert into public.site_return_memos(id,organization_id,branch_id,site_id,customer_id,invoice_id,invoice_item_id,product_id,quantity,unit,original_net_rate,original_unit_cost)
      values(v_id,p_organization_id,p_branch_id,v_site.id,v_site.customer_id,v_invoice.id,v_item.id,v_item.product_id,v_quantity,v_item.unit,v_net,v_item.unit_cost);
    v_result:=jsonb_build_object('id',v_id,'status','PENDING_PICKUP','net_rate',v_net);
  elsif p_tool='erp_transfer_site_material' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'returns.create');
    select * into strict v_memo from public.site_return_memos where id=(p_payload->>'memoId')::uuid and organization_id=p_organization_id and branch_id=p_branch_id for update;
    select * into strict v_target from public.customer_sites where id=(p_payload->>'targetSiteId')::uuid and organization_id=p_organization_id and branch_id=p_branch_id;
    v_quantity:=(p_payload->>'quantity')::numeric;
    if v_memo.version<>(p_payload->>'memoVersion')::integer or v_memo.status not in('PENDING_PICKUP','PARTIAL')
      or v_target.customer_id<>v_memo.customer_id or v_target.id=v_memo.site_id
      or v_quantity<=0 or v_quantity::text in('NaN','Infinity','-Infinity') or v_memo.allocated+v_quantity>v_memo.quantity then
      raise exception using errcode='40001',message='Site allocation changed or quantity exceeded';
    end if;
    v_estimate:=public.create_estimate_atomic(jsonb_build_object('organization_id',p_organization_id,'customer_id',v_memo.customer_id,
      'estimate_number',p_payload->>'number','issue_date',p_payload->>'date','currency_code','PKR'),
      p_payload->'lines','AI_ASSISTED',null,p_branch_id,p_actor_user_id,p_idempotency_key||'-quote');
    if jsonb_array_length(p_payload->'lines')<>1 or (p_payload->'lines'->0->>'product_id')::bigint<>v_memo.product_id
      or (p_payload->'lines'->0->>'quantity')::numeric<>v_quantity then raise exception using errcode='22023',message='Transfer quote mismatch'; end if;
    insert into public.site_transfers(id,organization_id,branch_id,memo_id,target_site_id,quantity,discount_percent,target_estimate_id,challan)
      values(v_id,p_organization_id,p_branch_id,v_memo.id,v_target.id,v_quantity,(p_payload->>'discount')::numeric,(v_estimate->'estimate'->>'id')::bigint,p_payload->'challan');
    update public.site_return_memos set allocated=allocated+v_quantity,version=version+1,status='PARTIAL' where id=v_memo.id;
    v_result:=jsonb_build_object('id',v_id,'status','PLANNED','estimate_id',v_estimate->'estimate'->'id','challan',p_payload->'challan');
  elsif p_tool='erp_deliver_site_transfer' then
    perform private.depot_authorize(p_actor_user_id,p_organization_id,p_branch_id,'returns.create');
    select * into strict v_transfer from public.site_transfers where id=(p_payload->>'transferId')::uuid and organization_id=p_organization_id and branch_id=p_branch_id for update;
    select * into strict v_memo from public.site_return_memos where id=v_transfer.memo_id and organization_id=p_organization_id and branch_id=p_branch_id for update;
    if v_transfer.status<>'PLANNED' or v_transfer.version<>(p_payload->>'transferVersion')::integer then raise exception using errcode='40001',message='Transfer changed'; end if;
    v_lines:=p_payload->'sale'->'lines';
    if jsonb_array_length(v_lines)<>1 or (v_lines->0->>'product_id')::bigint<>v_memo.product_id
      or (v_lines->0->>'quantity')::numeric<>v_transfer.quantity or (v_lines->0->>'unit_cost')::numeric<>v_memo.original_unit_cost
      or (p_payload->'sale'->'invoice'->>'customer_id')::bigint<>v_memo.customer_id then raise exception using errcode='22023',message='Transfer financial payload mismatch'; end if;
    -- Recheck the approved destination rate. No current-catalog rates ever enter the source credit.
    select i.unit_price into v_price from public.rate_list_items i join public.rate_list_versions v on v.id=i.rate_list_version_id
      join public.rate_lists l on l.id=v.rate_list_id where i.product_id=v_memo.product_id and l.organization_id=p_organization_id
      and l.id=(p_payload->'rate'->>'rate_list_id')::bigint and v.id=(p_payload->'rate'->>'rate_list_version_id')::bigint
      and l.is_active and l.price_type='SALE' and l.currency_code='PKR' and (l.scope_type='GLOBAL' or (l.scope_type='CUSTOMER' and l.customer_id=v_memo.customer_id))
      and v.status='ACTIVE' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
      and i.minimum_quantity<=v_transfer.quantity order by i.minimum_quantity desc limit 1;
    if v_price is null or v_price is distinct from (v_lines->0->>'unit_price')::numeric then raise exception using errcode='40001',message='Destination active rate changed'; end if;
    v_credit:=public.record_sales_return(
      p_organization_id=>p_organization_id,p_branch_id=>p_branch_id,p_actor_user_id=>p_actor_user_id,p_service_principal=>p_service_principal,
      p_operation_scope=>'sales-return.create',p_credit_note_number=>(p_payload->>'number')||'-RET',p_invoice_id=>v_memo.invoice_id,
      p_customer_id=>v_memo.customer_id,p_credit_date=>(p_payload->>'date')::date,p_currency_code=>'PKR',p_reason=>'Inter-site material transfer',
      p_notes=>'Virtual site pickup and delivery',
      p_items=>jsonb_build_array(jsonb_build_object('invoice_item_id',v_memo.invoice_item_id,'warehouse_id',(p_payload->>'warehouseId')::bigint,'quantity',v_transfer.quantity)),
      p_idempotency_key=>p_idempotency_key||'-return',p_request_fingerprint=>repeat(md5(p_payload::text),2));
    v_sale:=public.commit_copilot_sale(p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,p_idempotency_key||'-sale',p_payload->'sale');
    update public.site_transfers set status='DELIVERED',version=version+1,credit_note_id=(v_credit->'credit_note'->>'id')::bigint,invoice_id=(v_sale->>'invoice_id')::bigint where id=v_transfer.id;
    if v_memo.allocated=v_memo.quantity and not exists(select 1 from public.site_transfers where memo_id=v_memo.id and status='PLANNED') then
      update public.site_return_memos set status='TRANSFERRED',version=version+1 where id=v_memo.id;
    end if;
    v_result:=jsonb_build_object('id',v_transfer.id,'status','DELIVERED','credit_note_id',v_credit->'credit_note'->'id','invoice_id',v_sale->'invoice_id');
  elsif p_tool='erp_create_dispatch' then
    v_snapshot:=public.estimate_conversion_snapshot((p_payload->>'estimateId')::bigint,p_organization_id);
    if v_snapshot is null or v_snapshot->'record'->>'branch_id'<>p_branch_id::text
      or v_snapshot->>'source_fingerprint' is distinct from p_payload->>'sourceFingerprint'
      or v_snapshot->'record'->>'status' in('CONVERTED','CANCELLED') then raise exception using errcode='40001',message='Estimate changed'; end if;
    if p_payload->>'siteId' is not null and not exists(select 1 from public.customer_sites s where s.id=(p_payload->>'siteId')::uuid
      and s.organization_id=p_organization_id and s.branch_id=p_branch_id and s.customer_id=(v_snapshot->'record'->>'customer_id')::bigint) then
      raise exception using errcode='42501',message='Dispatch site mismatch';
    end if;
    insert into public.dispatch_orders(id,organization_id,branch_id,estimate_id,site_id,challan)
      values(v_id,p_organization_id,p_branch_id,(p_payload->>'estimateId')::bigint,(p_payload->>'siteId')::uuid,p_payload->'challan');
    insert into public.dispatch_items(dispatch_id,organization_id,branch_id,line_number,product_id,quantity,unit)
      select v_id,p_organization_id,p_branch_id,(x->>'line_number')::integer,(x->>'product_id')::bigint,(x->>'quantity')::numeric,x->>'unit'
      from jsonb_array_elements(v_snapshot->'items') x;
    update public.estimates set status='READY' where id=(p_payload->>'estimateId')::bigint and organization_id=p_organization_id and status='DRAFT';
    v_result:=jsonb_build_object('id',v_id,'status','PICKING','challan',p_payload->'challan');
  elsif p_tool='erp_record_dispatch' then
    select * into strict v_order from public.dispatch_orders where id=(p_payload->>'dispatchId')::uuid and organization_id=p_organization_id and branch_id=p_branch_id for update;
    if v_order.status in('DELIVERED','CANCELLED') or v_order.version<>(p_payload->>'orderVersion')::integer then raise exception using errcode='40001',message='Dispatch changed'; end if;
    if jsonb_array_length(p_payload->'lines')=0 or (select count(distinct x->>'lineNumber') from jsonb_array_elements(p_payload->'lines') x)<>jsonb_array_length(p_payload->'lines') then
      raise exception using errcode='22023',message='Unique dispatch lines required';
    end if;
    for v_line in select value from jsonb_array_elements(p_payload->'lines') loop
      select * into strict v_row from public.dispatch_items where dispatch_id=v_order.id and line_number=(v_line->>'lineNumber')::integer for update;
      v_quantity:=(v_line->>'quantity')::numeric;
      if v_quantity<=0 or v_quantity::text in('NaN','Infinity','-Infinity') then raise exception using errcode='22023',message='Positive finite dispatch quantity required'; end if;
      if p_payload->>'event'='DISPATCH' then update public.dispatch_items set dispatched=dispatched+v_quantity where dispatch_id=v_order.id and line_number=v_row.line_number;
      elsif p_payload->>'event'='DELIVER' then update public.dispatch_items set delivered=delivered+v_quantity where dispatch_id=v_order.id and line_number=v_row.line_number;
      else raise exception using errcode='22023',message='Unknown dispatch event'; end if;
    end loop;
    select bool_and(delivered=quantity) into v_all from public.dispatch_items where dispatch_id=v_order.id;
    if v_all then
      v_snapshot:=public.estimate_conversion_snapshot(v_order.estimate_id,p_organization_id);
      if v_snapshot->>'source_fingerprint' is distinct from p_payload->>'sourceFingerprint' then
        raise exception using errcode='40001',message='Final delivery estimate changed';
      end if;
      if p_payload->'sale' is null or (p_payload->'sale'->'invoice'->>'source_estimate_id')::bigint<>v_order.estimate_id then
        raise exception using errcode='22023',message='Final delivery requires the approved estimate invoice';
      end if;
      v_sale:=public.commit_copilot_sale(p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,p_idempotency_key||'-invoice',p_payload->'sale');
      update public.dispatch_orders set status='DELIVERED',invoice_id=(v_sale->>'invoice_id')::bigint,version=version+1 where id=v_order.id;
    else
      if p_payload->'sale' is not null then raise exception using errcode='22023',message='Partial delivery cannot post the final invoice'; end if;
      update public.dispatch_orders set status=case when (select bool_and(dispatched=quantity) from public.dispatch_items where dispatch_id=v_order.id) then 'DISPATCHED' else 'PARTIAL' end,version=version+1 where id=v_order.id;
    end if;
    insert into public.dispatch_events(organization_id,branch_id,dispatch_id,actor_user_id,event,lines)
      values(p_organization_id,p_branch_id,v_order.id,p_actor_user_id,p_payload->>'event',p_payload->'lines');
    v_result:=jsonb_build_object('id',v_order.id,'status',case when v_all then 'DELIVERED' else 'PARTIAL' end,'invoice_id',v_sale->'invoice_id');
  elsif p_tool='erp_log_expense' then
    v_quantity:=(p_payload->>'amount')::numeric;
    if v_quantity<=0 or v_quantity::text in('NaN','Infinity','-Infinity') or nullif(btrim(p_payload->>'description'),'') is null then raise exception using errcode='22023',message='Expense details invalid'; end if;
    select a.id into strict v_expense_account from public.accounts a where a.id=(p_payload->>'expenseAccountId')::uuid and a.code=p_payload->>'expenseAccountCode' and a.account_type='EXPENSE' and a.is_active;
    select a.id into strict v_cash_account from public.accounts a where a.id=(p_payload->>'cashAccountId')::uuid and a.code=p_payload->>'cashAccountCode' and a.account_type='ASSET' and a.is_active;
    if p_payload->>'salespersonId' is not null and not exists(select 1 from public.salespeople where id=(p_payload->>'salespersonId')::bigint and organization_id=p_organization_id) then raise exception using errcode='42501',message='Salesperson mismatch'; end if;
    v_journal:=private.post_depot_expense(p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,v_id,
      (p_payload->>'date')::date,p_payload->>'description',v_quantity,v_expense_account,p_payload->>'expenseAccountCode',
      v_cash_account,p_payload->>'cashAccountCode',p_idempotency_key,v_fingerprint);
    insert into public.depot_expenses(id,organization_id,branch_id,description,amount,expense_date,kind,salesperson_id,journal_entry_id,expense_account_id,cash_account_id)
      values(v_id,p_organization_id,p_branch_id,p_payload->>'description',v_quantity,(p_payload->>'date')::date,p_payload->>'kind',(p_payload->>'salespersonId')::bigint,v_journal,v_expense_account,v_cash_account);
    v_result:=jsonb_build_object('id',v_id,'journal_entry_id',v_journal,'status','POSTED');
  elsif p_tool='erp_update_commodity_rates' then
    if nullif(btrim(p_payload->>'reason'),'') is null or jsonb_array_length(p_payload->'rates')=0 then raise exception using errcode='22023',message='Reason and prices required'; end if;
    if (select count(distinct jsonb_build_array(x->>'productId',x->>'rateListId',x->>'minimumQuantity')) from jsonb_array_elements(p_payload->'rates') x)<>jsonb_array_length(p_payload->'rates') then raise exception using errcode='22023',message='Duplicate price override'; end if;
    for v_list in select distinct (x->>'rateListId')::bigint from jsonb_array_elements(p_payload->'rates') x order by 1 loop
      perform 1 from public.rate_lists where id=v_list and organization_id=p_organization_id and price_type='SALE' and is_active for update;
      if not found then raise exception using errcode='42501',message='Sale rate list mismatch'; end if;
      select * into strict v_old from public.rate_list_versions where rate_list_id=v_list and status='ACTIVE' for update;
      if exists(select 1 from jsonb_array_elements(p_payload->'rates') x where (x->>'rateListId')::bigint=v_list and (x->>'versionId')::bigint<>v_old.id) then raise exception using errcode='40001',message='Active price version changed'; end if;
      insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from,standard_discount_percent)
        select v_list,coalesce(max(version_number),0)+1,'DRAFT',now(),v_old.standard_discount_percent from public.rate_list_versions where rate_list_id=v_list returning id into v_new;
      insert into public.rate_list_items(rate_list_version_id,product_id,minimum_quantity,unit_price,unit)
        select v_new,product_id,minimum_quantity,unit_price,unit from public.rate_list_items where rate_list_version_id=v_old.id;
      for v_line in select value from jsonb_array_elements(p_payload->'rates') where (value->>'rateListId')::bigint=v_list loop
        v_price:=(v_line->>'newPrice')::numeric;
        if v_price<0 or v_price::text in('NaN','Infinity','-Infinity') then raise exception using errcode='22023',message='Invalid new price'; end if;
        if not exists(select 1 from public.products where id=(v_line->>'productId')::bigint and organization_id=p_organization_id) then raise exception using errcode='42501',message='Product mismatch'; end if;
        update public.rate_list_items set unit_price=v_price where rate_list_version_id=v_new and product_id=(v_line->>'productId')::bigint
          and minimum_quantity=(v_line->>'minimumQuantity')::numeric and unit_price=(v_line->>'before')::numeric;
        if not found then raise exception using errcode='40001',message='Approved catalog price changed'; end if;
        update public.products set sale_price=v_price where id=(v_line->>'productId')::bigint and organization_id=p_organization_id;
        insert into public.depot_price_changes(organization_id,branch_id,actor_user_id,product_id,old_version_id,new_version_id,old_price,new_price,reason)
          values(p_organization_id,p_branch_id,p_actor_user_id,(v_line->>'productId')::bigint,v_old.id,v_new,(v_line->>'before')::numeric,v_price,p_payload->>'reason');
      end loop;
      update public.rate_list_versions set status='ARCHIVED',effective_to=now() where id=v_old.id;
      update public.rate_list_versions set status='ACTIVE' where id=v_new;
    end loop;
    v_result:=jsonb_build_object('id',v_id,'status','UPDATED','itemCount',jsonb_array_length(p_payload->'rates'));
  else raise exception using errcode='22023',message='Unknown depot operation';
  end if;
  insert into public.depot_action_receipts(organization_id,branch_id,actor_user_id,tool,idempotency_key,fingerprint,result)
    values(p_organization_id,p_branch_id,p_actor_user_id,p_tool,p_idempotency_key,v_fingerprint,v_result);
  return v_result;
end $$;
revoke all on function public.commit_depot_action(uuid,uuid,uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_depot_action(uuid,uuid,uuid,text,text,jsonb,text) to service_role;
