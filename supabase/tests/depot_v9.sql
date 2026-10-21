-- Every fixture, stock movement, credit and journal is rolled back.
begin;
create function pg_temp.depot_check(ok boolean,message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'DEPOT ASSERTION: %',message; end if; end $$;
grant execute on function pg_temp.depot_check(boolean,text) to service_role;
do $$
declare
  org uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();actor uuid:=gen_random_uuid();branch uuid:=gen_random_uuid();
  brand bigint;other_brand bigint;pipe bigint;elbow bigint;other_size bigint;popular bigint;list bigint;version bigint;warehouse bigint;customer bigint;
  result jsonb;replay jsonb;definition jsonb;lines jsonb;payload jsonb;snapshot jsonb;receipt jsonb;invoice bigint;invoice_item bigint;
  dispatch uuid:=gen_random_uuid();site_a uuid:=gen_random_uuid();site_b uuid:=gen_random_uuid();memo uuid:=gen_random_uuid();transfer uuid:=gen_random_uuid();expense uuid:=gen_random_uuid();
  expense_account uuid;cash_account uuid;new_version bigint;before_stock numeric;count_before bigint;i integer;line jsonb;sale jsonb;
begin
  insert into auth.users(id) values(actor);
  insert into public.organizations(id,name,slug) values(org,'Depot V9 fixture',org::text),(foreign_org,'Other depot',foreign_org::text);
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
  insert into public.branches(id,organization_id,code,name) values(branch,org,'V9','V9 branch');
  insert into public.branch_access_grants(organization_id,branch_id,user_id) values(org,branch,actor);
  insert into public.brands(organization_id,name) values(org,'Dura Max') returning id into brand;
  insert into public.brands(organization_id,name) values(org,'Popular') returning id into other_brand;
  insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
    values(org,brand,'Dura Max PPR-C Pipe 25mm PN-16','V9-PIPE','Pipes','pcs',20,100) returning id into pipe;
  insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
    values(org,brand,'Dura Max PPR-C Elbow 25mm','V9-ELBOW','Fittings','pcs',40,200) returning id into elbow;
  insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
    values(org,brand,'Dura Max PPR-C Elbow 32mm','V9-32','Fittings','pcs',40,200) returning id into other_size;
  insert into public.products(organization_id,brand_id,name,sku,category,unit,purchase_price,sale_price)
    values(org,other_brand,'Popular PPR-C Elbow 25mm','V9-POPULAR','Fittings','pcs',40,190) returning id into popular;
  insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code,is_active) values(org,'Dura Max V9','V9-'||org,'SALE','GLOBAL','PKR',true) returning id into list;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(list,1,'ACTIVE',now()-interval '1 day') returning id into version;
  insert into public.rate_list_items(rate_list_version_id,product_id,minimum_quantity,unit_price,unit) values(version,pipe,1,100,'pcs'),(version,elbow,1,200,'pcs'),(version,other_size,1,200,'pcs'),(version,popular,1,190,'pcs');
  insert into public.warehouses(organization_id,name,location) values(org,'V9 warehouse','Fixture') returning id into warehouse;
  insert into public.inventory(organization_id,product_id,warehouse_id,quantity) values(org,pipe,warehouse,0),(org,elbow,warehouse,0);
  insert into public.accounts(code,name,account_type,normal_balance) values('6199','V9 operating expense','EXPENSE','DEBIT') on conflict(code) do nothing;
  select id into expense_account from public.accounts where code='6199';select id into cash_account from public.accounts where code='1000';
  set local role service_role;
  perform pg_temp.depot_check((select count(*)=1 from public.search_catalog_products(actor,org,branch,'PPR-C Elbow 25mm','Dura Max',20)),'brand and 25mm filter exclude Popular and 32mm');
  perform pg_temp.depot_check((select id=elbow from public.search_catalog_products(actor,org,branch,'PPR-C Elbow 25mm','Dura Max',20)),'exact sized Dura candidate');
  begin perform public.search_catalog_products(actor,foreign_org,branch,'Elbow 25mm','Dura Max',20);raise exception 'Expected foreign search rejection';exception when insufficient_privilege then null;end;
  definition:=jsonb_build_object('estimate_number','V9-EST-'||org,'issue_date',current_date,'currency_code','PKR');
  lines:=jsonb_build_array(
    jsonb_build_object('line_number',1,'product_id',pipe,'quantity',2,'unit','pcs','unit_price',100,'discount_amount',100,'pricing_source','RESOLVED_RATE','rate_list_id',list,'rate_list_version_id',version),
    jsonb_build_object('line_number',2,'product_id',elbow,'quantity',2,'unit','pcs','unit_price',200,'discount_amount',200,'pricing_source','RESOLVED_RATE','rate_list_id',list,'rate_list_version_id',version));
  result:=public.create_copilot_customer_estimate(org,branch,actor,'new-customer',jsonb_build_object('name','Waseem Mazhar Bhai','city','Ittehad Town, Lahore','phone',''),definition,lines);
  replay:=public.create_copilot_customer_estimate(org,branch,actor,'new-customer',jsonb_build_object('name','Waseem Mazhar Bhai','city','Ittehad Town, Lahore','phone',''),definition,lines);
  customer:=(result->'estimate'->>'customer_id')::bigint;
  perform pg_temp.depot_check(result=replay,'chained customer/estimate replay returns identical result');
  perform pg_temp.depot_check((select count(*)=1 from public.customers where organization_id=org),'exactly one new customer');
  perform pg_temp.depot_check((select sum(quantity)=0 from public.inventory where organization_id=org),'zero stock does not block estimate or mutate stock');
  perform pg_temp.depot_check((select sum((x->>'discount_amount')::numeric)=300 from jsonb_array_elements(result->'items') x),'50% discount and active rates preserved');
  begin
    perform public.create_copilot_customer_estimate(org,branch,actor,'bad-customer',jsonb_build_object('name','Rollback customer','city','Lahore'),
      definition||jsonb_build_object('estimate_number','BAD-'||org),lines||jsonb_build_array(lines->0||jsonb_build_object('line_number',3,'discount_amount',99999)));
    raise exception 'Expected bad line rejection';
  exception when invalid_parameter_value then null;end;
  perform pg_temp.depot_check((select count(*)=1 from public.customers where organization_id=org),'bad estimate leaves no orphan customer');
  for i in 1..3 loop
    perform public.create_estimate_atomic(definition||jsonb_build_object('organization_id',org,'customer_id',customer,'estimate_number','LEARN-'||org||'-'||i),lines,'AI_ASSISTED',null,branch,actor,'learn-'||i);
  end loop;
  perform pg_temp.depot_check((select product_id=elbow from public.depot_companion_suggestions(org,branch,actor,array[pipe],'Dura Max')),'confirmed estimate co-purchases expand companion memory');
  snapshot:=public.estimate_conversion_snapshot((result->'estimate'->>'id')::bigint,org);
  payload:=jsonb_build_object('id',dispatch,'estimateId',result->'estimate'->'id','sourceFingerprint',snapshot->>'source_fingerprint','challan',jsonb_build_object('lines',jsonb_build_array(jsonb_build_object('name','Pipe','quantity',2,'unit','pcs'))));
  receipt:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_create_dispatch',payload,'dispatch-create');
  perform pg_temp.depot_check(not ((receipt->'challan')::text like '%unit_price%'),'challan has no price data');
  snapshot:=public.estimate_conversion_snapshot((result->'estimate'->>'id')::bigint,org);
  payload:=jsonb_build_object('id',gen_random_uuid(),'dispatchId',dispatch,'event','DISPATCH','orderVersion',1,'lines',jsonb_build_array(jsonb_build_object('lineNumber',1,'quantity',1)));
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload,'dispatch-part');
  payload:=jsonb_set(payload,'{orderVersion}','2')||jsonb_build_object('event','DELIVER');
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload,'deliver-part');
  perform pg_temp.depot_check((select delivered=1 and dispatched=1 and quantity=2 from public.dispatch_items where dispatch_id=dispatch and line_number=1),'partial quantities exact');
  perform pg_temp.depot_check((select count(*)=0 from public.invoices where organization_id=org),'partial delivery does not post final invoice');
  begin
    perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload||jsonb_build_object('orderVersion',3,'event','DISPATCH','lines',jsonb_build_array(jsonb_build_object('lineNumber',1,'quantity',9))),'over-dispatch');
    raise exception 'Expected overdispatch rejection';
  exception when check_violation then null;end;
  payload:=jsonb_build_object('id',gen_random_uuid(),'dispatchId',dispatch,'event','DISPATCH','orderVersion',3,'lines',jsonb_build_array(jsonb_build_object('lineNumber',1,'quantity',1),jsonb_build_object('lineNumber',2,'quantity',2)));
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload,'dispatch-rest');
  sale:=jsonb_build_object('warehouseId',warehouse,'paidAmount',0,'invoice',jsonb_build_object('invoice_number','V9-INV-'||org,'customer_id',customer,'source_type','FROM_ESTIMATE','source_estimate_id',result->'estimate'->'id','issue_date',current_date,'currency_code','PKR','subtotal',600,'discount_total',300,'grand_total',300,'pass_through_rent',0),
    'lines',jsonb_build_array(
      jsonb_build_object('line_number',1,'product_id',pipe,'quantity',2,'unit','pcs','unit_price',100,'line_total',200,'unit_cost',20,'cogs_total',40,'gross_unit_price',100,'customer_discount_percent',50,'customer_discount_amount',100),
      jsonb_build_object('line_number',2,'product_id',elbow,'quantity',2,'unit','pcs','unit_price',200,'line_total',400,'unit_cost',40,'cogs_total',80,'gross_unit_price',200,'customer_discount_percent',50,'customer_discount_amount',200)));
  snapshot:=public.estimate_conversion_snapshot((result->'estimate'->>'id')::bigint,org);
  payload:=payload||jsonb_build_object('event','DELIVER','orderVersion',4,'sale',sale,'sourceFingerprint',snapshot->>'source_fingerprint');
  begin perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload,'deliver-final');raise exception 'Expected zero stock invoice rejection';
  exception when sqlstate 'P0004' then null;end;
  perform pg_temp.depot_check((select delivered=1 from public.dispatch_items where dispatch_id=dispatch and line_number=1),'failed final invoice rolls delivery event back');
  reset role;
  update public.inventory set quantity=100 where organization_id=org;
  set local role service_role;
  receipt:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_record_dispatch',payload,'deliver-final');
  invoice:=(receipt->>'invoice_id')::bigint;
  perform pg_temp.depot_check(invoice>0 and (select status='DELIVERED' from public.dispatch_orders where id=dispatch),'complete delivery posts invoice atomically');
  perform pg_temp.depot_check((select grand_total=300 from public.invoices where id=invoice),'final invoice total unchanged by partial tracking');
  payload:=jsonb_build_object('id',expense,'description','Fixture carriage','amount',50,'date',current_date,'kind','expense','expenseAccountId',expense_account,'expenseAccountCode','6199','cashAccountId',cash_account,'cashAccountCode','1000');
  receipt:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_log_expense',payload,'expense');
  replay:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_log_expense',payload,'expense');
  perform pg_temp.depot_check(receipt=replay and (select count(*)=1 from public.depot_expenses where organization_id=org),'expense idempotency');
  reset role;
  perform pg_temp.depot_check((select sum(debit)=sum(credit) and sum(debit)=50 from public.journal_lines where journal_entry_id=(receipt->>'journal_entry_id')::uuid),'expense journal balanced');
  set local role service_role;
  payload:=jsonb_build_object('id',gen_random_uuid(),'reason','Daily board','rates',jsonb_build_array(
    jsonb_build_object('productId',pipe,'rateListId',list,'versionId',version,'minimumQuantity',1,'before',100,'newPrice',120),
    jsonb_build_object('productId',elbow,'rateListId',list,'versionId',version,'minimumQuantity',1,'before',200,'newPrice',240)));
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_update_commodity_rates',payload,'board');
  select id into new_version from public.rate_list_versions where rate_list_id=list and status='ACTIVE';
  perform pg_temp.depot_check(new_version<>version and (select unit_price=120 from public.rate_list_items where rate_list_version_id=new_version and product_id=pipe),'daily board creates active price version');
  perform pg_temp.depot_check((select count(*)=4 from public.rate_list_items where rate_list_version_id=new_version),'unmodified catalog rows preserved');
  payload:=jsonb_build_object('id',site_a,'customerId',customer,'name','Site A','address','Al-Kabir');
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_create_site',payload,'site-a');
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_create_site',payload||jsonb_build_object('id',site_b,'name','Site B','address','Bahria Orchard'),'site-b');
  select id into invoice_item from public.invoice_items where invoice_id=invoice and product_id=pipe;
  payload:=jsonb_build_object('id',memo,'siteId',site_a,'invoiceId',invoice,'invoiceItemId',invoice_item,'quantity',1,'originalNetRate',50,'originalUnitCost',20);
  receipt:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_prepare_site_return',payload,'memo');
  perform pg_temp.depot_check((receipt->>'net_rate')::numeric=50,'site memo binds original discounted rate, not new 120 rate');
  select quantity into before_stock from public.inventory where organization_id=org and product_id=pipe and warehouse_id=warehouse;
  line:=jsonb_build_object('line_number',1,'product_id',pipe,'quantity',1,'unit','pcs','unit_price',120,'discount_amount',0,'pricing_source','RESOLVED_RATE','rate_list_id',list,'rate_list_version_id',new_version);
  payload:=jsonb_build_object('id',transfer,'number','V9-TRANSFER-'||org,'date',current_date,'memoId',memo,'memoVersion',1,'targetSiteId',site_b,'quantity',1,'discount',0,'lines',jsonb_build_array(line),'challan',jsonb_build_object('text','▢ Pipe 25mm — 1 pcs'));
  perform public.commit_depot_action(org,branch,actor,'v9-regression','erp_transfer_site_material',payload,'transfer');
  perform pg_temp.depot_check((select quantity=before_stock from public.inventory where organization_id=org and product_id=pipe and warehouse_id=warehouse),'planning site transfer does not move warehouse stock');
  sale:=jsonb_build_object('warehouseId',warehouse,'paidAmount',0,'invoice',jsonb_build_object('invoice_number','V9-SITE-SALE-'||org,'customer_id',customer,'source_type','DIRECT','issue_date',current_date,'currency_code','PKR','subtotal',120,'discount_total',0,'grand_total',120,'pass_through_rent',0),
    'lines',jsonb_build_array(jsonb_build_object('line_number',1,'product_id',pipe,'quantity',1,'unit','pcs','unit_price',120,'line_total',120,'unit_cost',20,'cogs_total',20,'gross_unit_price',120,'customer_discount_percent',0,'customer_discount_amount',0)));
  payload:=jsonb_build_object('id',gen_random_uuid(),'number','V9-SITE-DEL-'||org,'date',current_date,'transferId',transfer,'transferVersion',1,'warehouseId',warehouse,'sale',sale,
    'rate',jsonb_build_object('rate_list_id',list,'rate_list_version_id',new_version));
  receipt:=public.commit_depot_action(org,branch,actor,'v9-regression','erp_deliver_site_transfer',payload,'transfer-deliver');
  perform pg_temp.depot_check((select grand_total=50 from public.credit_notes where id=(receipt->>'credit_note_id')::bigint),'source credited exactly 50');
  perform pg_temp.depot_check((select grand_total=120 from public.invoices where id=(receipt->>'invoice_id')::bigint),'target invoiced at active 120 capturing appreciation');
  perform pg_temp.depot_check((select quantity=before_stock from public.inventory where organization_id=org and product_id=pipe and warehouse_id=warehouse),'virtual receipt/dispatch nets to zero warehouse stock');
  perform pg_temp.depot_check((select status='TRANSFERRED' from public.site_return_memos where id=memo),'completed memo state');
  reset role;
  update public.customers set credit_limit=1 where id=customer;
  set local role service_role;
  receipt:=public.depot_intelligence_report(org,branch,actor,jsonb_build_object('report','credit_guard','customerId',customer));
  perform pg_temp.depot_check(jsonb_array_length(receipt->'warnings')=1,'credit guard alerts without blocking quotations');
  foreach payload in array array[jsonb_build_object('report','top_sellers'),jsonb_build_object('report','customer_profitability'),jsonb_build_object('report','reorder_deadstock'),jsonb_build_object('report','closing'),jsonb_build_object('report','salesman_roi'),jsonb_build_object('report','accounts')] loop
    receipt:=public.depot_intelligence_report(org,branch,actor,payload);
    perform pg_temp.depot_check(receipt->'data' is not null,'scoped depot report returns data');
  end loop;
  select count(*) into count_before from public.depot_action_receipts where organization_id=org;
  begin perform public.commit_depot_action(foreign_org,branch,actor,'v9-regression','erp_create_site',jsonb_build_object('id',gen_random_uuid(),'customerId',customer,'name','Forbidden','address','Other'),'foreign');raise exception 'Expected foreign mutation denial';
  exception when insufficient_privilege then null;end;
  perform pg_temp.depot_check((select count(*)=count_before from public.depot_action_receipts where organization_id=org),'foreign mutation leaves no receipt');
end $$;
rollback;
