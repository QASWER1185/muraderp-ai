-- Disposable PostgreSQL only. Every fixture and ledger mutation rolls back.
begin;
create function pg_temp.memory_check(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'MEMORY ASSERTION: %',message; end if; end $$;
grant execute on function pg_temp.memory_check(boolean,text) to service_role;
do $$
declare
  org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid();
  customer bigint; product bigint; brand bigint; warehouse bigint; invoice bigint; item bigint;
  result jsonb; replay jsonb; legacy jsonb; returned jsonb; payload jsonb; patterns jsonb; source_estimate jsonb; converted jsonb;
  action uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid();
begin
  insert into auth.users(id) values(actor);
  insert into public.organizations(id,name,slug) values(org,'Memory Fixture',org::text),(other_org,'Other memory fixture',other_org::text);
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
  insert into public.branches(id,organization_id,code,name) values(branch,org,'MEM','Memory branch');
  insert into public.branch_access_grants(organization_id,branch_id,user_id) values(org,branch,actor);
  insert into public.customers(organization_id,name,phone,city) values(org,'Faisal Butt','000','Fixture') returning id into customer;
  insert into public.brands(organization_id,name) values(org,'Dura Max') returning id into brand;
  insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
    values(org,brand,'Dura Max Medium Pipe','MEM-PIPE','Pipes','pcs',25,100) returning id into product;
  insert into public.warehouses(organization_id,name,location) values(org,'Memory warehouse','Fixture') returning id into warehouse;
  insert into public.inventory(organization_id,product_id,warehouse_id,quantity) values(org,product,warehouse,100);
  insert into public.copilot_purchase_baselines(organization_id,brand_id,category,unit,wholesale_discount_percent)
    values(org,brand,'Pipes','pcs',50);
  perform pg_temp.memory_check(public.copilot_purchase_floor(org,product,100,'pcs','PKR')=50,'wholesale ceiling outranks lower stale product cost');
  perform pg_temp.memory_check(public.copilot_purchase_floor(other_org,product,100,'pcs','PKR') is null,'foreign product has no usable cost');
  perform pg_temp.memory_check(public.copilot_purchase_floor(org,product,100,'ft','PKR') is null,'unit mismatch cannot supply a floor');
  payload:=jsonb_build_object('warehouseId',warehouse,'paidAmount',0,
    'invoice',jsonb_build_object('invoice_number','MEM-'||org,'customer_id',customer,'source_type','DIRECT','issue_date','2026-10-18','currency_code','PKR','subtotal',400,'discount_total',140,'grand_total',260,'pass_through_rent',0),
    'lines',jsonb_build_array(
      jsonb_build_object('line_number',1,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'line_total',200,'unit_cost',25,'cogs_total',50,'gross_unit_price',100,'customer_discount_percent',50,'customer_discount_amount',100),
      jsonb_build_object('line_number',2,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'line_total',200,'unit_cost',25,'cogs_total',50,'gross_unit_price',100,'customer_discount_percent',20,'customer_discount_amount',40)));
  set local role service_role;
  result:=public.commit_copilot_sale(org,branch,actor,'memory-regression','sale',payload);
  replay:=public.commit_copilot_sale(org,branch,actor,'memory-regression','sale',payload);
  invoice:=(result->>'invoice_id')::bigint;
  perform pg_temp.memory_check((replay->>'invoice_id')::bigint=invoice,'invoice replay preserves identity');
  perform pg_temp.memory_check((select count(*)=2 from public.copilot_commercial_history where organization_id=org and document_id=invoice),'all line facts remembered');
  perform pg_temp.memory_check((select net_unit_price=50 and discount_percent=50 from public.copilot_commercial_history where document_id=invoice and source_item_id=(select id from public.invoice_items where invoice_id=invoice and line_number=1)),'first line remembers exact 50 percent');
  perform pg_temp.memory_check((select net_unit_price=80 and discount_percent=20 from public.copilot_commercial_history where document_id=invoice and source_item_id=(select id from public.invoice_items where invoice_id=invoice and line_number=2)),'mixed line discounts are not prorated');
  select id into item from public.invoice_items where invoice_id=invoice and line_number=1;
  returned:=public.record_sales_return(org,branch,actor,'memory-regression','sales-return.create','CR-'||org,invoice,customer,current_date,'PKR','unused',null,
    jsonb_build_array(jsonb_build_object('invoice_item_id',item,'warehouse_id',warehouse,'quantity',1)),'return',repeat('a',64));
  perform pg_temp.memory_check((returned->'credit_note'->>'grand_total')::numeric=50,'return credits net, not gross');
  perform pg_temp.memory_check((returned->'items'->0->>'unit_price')::numeric=50,'credit line binds historical rate');
  perform pg_temp.memory_check((select sum(jl.credit)=50 from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id join public.accounts a on a.id=jl.account_id where je.source_type='CREDIT_NOTE' and je.source_record_id=returned->'credit_note'->>'id' and je.organization_id=org and a.code='1100'),'AR credit matches net return');
  begin
    perform public.record_sales_return(org,branch,actor,'memory-regression','sales-return.create','OVER-'||org,invoice,customer,current_date,'PKR','unused',null,
      jsonb_build_array(jsonb_build_object('invoice_item_id',item,'warehouse_id',warehouse,'quantity',2)),'over-return',repeat('b',64));
    raise exception 'Expected excess return rejection';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.commit_copilot_sale(org,branch,actor,'memory-regression','bad-sale',
      jsonb_set(payload,'{lines,0,customer_discount_amount}','180'));
    raise exception 'Expected below-cost rejection';
  exception when invalid_parameter_value then null; end;
  legacy:=public.post_invoice_atomic(org,branch,actor,'memory-regression','sales.invoice.post','legacy','legacy',
    jsonb_build_object('invoice_number','LEGACY-'||org,'customer_id',customer,'source_type','DIRECT','issue_date','2026-10-17','currency_code','PKR','subtotal',200,'discount_total',100,'grand_total',100,'pass_through_rent',0),
    jsonb_build_array(jsonb_build_object('line_number',1,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'line_total',200,'unit_cost',25,'cogs_total',50)),warehouse);
  select id into item from public.invoice_items where invoice_id=(legacy->>'invoice_id')::bigint;
  perform pg_temp.memory_check(private.copilot_invoice_net_rate(item)=50,'legacy header discount is reconstructed');
  returned:=public.record_sales_return(org,branch,actor,'memory-regression','sales-return.create','LEGACY-CR-'||org,(legacy->>'invoice_id')::bigint,customer,current_date,'PKR','unused',null,
    jsonb_build_array(jsonb_build_object('invoice_item_id',item,'warehouse_id',warehouse,'quantity',1)),'legacy-return',repeat('c',64));
  perform pg_temp.memory_check((returned->'credit_note'->>'grand_total')::numeric=50,'legacy discounted return is zero loss');
  source_estimate:=public.create_estimate_atomic(
    jsonb_build_object('organization_id',org,'branch_id',branch,'customer_id',customer,'estimate_number','EST-'||org,'issue_date','2026-10-18','currency_code','PKR'),
    jsonb_build_array(
      jsonb_build_object('line_number',1,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'discount_amount',100,'pricing_source','MANUAL_OVERRIDE'),
      jsonb_build_object('line_number',2,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'discount_amount',40,'pricing_source','MANUAL_OVERRIDE')),
    'MANUAL',null,branch,actor,'native-estimate');
  update public.estimates set status='READY' where id=(source_estimate->'estimate'->>'id')::bigint;
  converted:=public.post_invoice_atomic(org,branch,actor,'memory-regression','sales.invoice.post','native-convert','native-convert',
    (payload->'invoice')||jsonb_build_object('invoice_number','NATIVE-'||org,'source_type','FROM_ESTIMATE','source_estimate_id',source_estimate->'estimate'->'id'),
    payload->'lines',warehouse);
  perform pg_temp.memory_check((select customer_discount_amount=100 and private.copilot_invoice_net_rate(id)=50 from public.invoice_items
    where invoice_id=(converted->>'invoice_id')::bigint and line_number=1),'native conversion snapshots exact per-line discount independently of the source estimate');
  reset role;
  patterns:='[{"raw_shorthand":"dm elb 3/4","verified_item_name":"Dura Max Elbow","verified_size":"3/4 inch","verified_unit":"pcs"}]';
  insert into public.ai_copilot_actions(id,organization_id,user_id,intent,status,idempotency_key,request_fingerprint,action_plan,result)
    values(action,org,actor,'estimate','CONFIRMED','learn',repeat('d',64),jsonb_build_object('branchId',branch,'source','image'),jsonb_build_object('id',invoice)),
      (unconfirmed,org,actor,'estimate','DRAFT','unconfirmed',repeat('e',64),jsonb_build_object('branchId',branch,'source','image'),null);
  set local role service_role;
  perform public.learn_confirmed_copilot_slip(org,branch,actor,action,patterns);
  perform public.learn_confirmed_copilot_slip(org,branch,actor,action,patterns);
  perform pg_temp.memory_check((select usage_count=1 from public.copilot_slip_patterns where organization_id=org),'confirmation replay does not inflate counts');
  begin
    perform public.learn_confirmed_copilot_slip(org,branch,actor,unconfirmed,patterns);
    raise exception 'Expected unconfirmed OCR rejection';
  exception when insufficient_privilege then null; end;
  begin
    perform public.learn_confirmed_copilot_slip(other_org,branch,actor,action,patterns);
    raise exception 'Expected tenant rejection';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.memory_check(not has_table_privilege('authenticated','public.copilot_slip_patterns','SELECT'),'browser cannot read learned text directly');
  perform pg_temp.memory_check(not has_table_privilege('anon','public.copilot_commercial_history','SELECT'),'anonymous commercial history blocked');
  perform pg_temp.memory_check(not has_function_privilege('authenticated','public.commit_copilot_sale(uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),'browser cannot invoke sale adapter');
  perform pg_temp.memory_check(to_regprocedure('public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb)') is not null,'approved customer profile action RPC is installed');
  perform pg_temp.memory_check(has_function_privilege('service_role','public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE'),'backend can invoke approved customer profile actions');
  perform pg_temp.memory_check(not has_function_privilege('authenticated','public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb)','EXECUTE'),'browser cannot bypass Copilot confirmation with direct profile RPC calls');
  raise notice 'Commercial recall, mixed discounts, historical net returns, floors, scoped learning, idempotency and profile writes PASS';
end;
$$;
rollback;
