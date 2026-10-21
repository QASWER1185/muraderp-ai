\set ON_ERROR_STOP on

create or replace function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function pg_temp.transaction_snapshot()
returns jsonb language sql as $$
  select jsonb_build_object(
    'purchases', (select count(*) from public.purchases),
    'purchase_items', (select count(*) from public.purchase_items),
    'purchase_idempotency', (select count(*) from public.purchase_idempotency_keys),
    'customer_payments', (select count(*) from public.customer_payments),
    'customer_payment_allocations', (select count(*) from public.customer_payment_allocations),
    'customer_payment_idempotency', (select count(*) from public.customer_payment_idempotency_keys),
    'credit_notes', (select count(*) from public.credit_notes),
    'credit_note_items', (select count(*) from public.credit_note_items),
    'credit_note_idempotency', (select count(*) from public.credit_note_idempotency_keys),
    'vendor_payments', (select count(*) from public.vendor_payments),
    'vendor_payment_allocations', (select count(*) from public.vendor_payment_allocations),
    'vendor_payment_idempotency', (select count(*) from public.vendor_payment_idempotency_keys),
    'stock_movements', (select count(*) from public.stock_movements),
    'inventory_state', (select coalesce(jsonb_agg(jsonb_build_array(id,organization_id,product_id,warehouse_id,quantity) order by id),'[]'::jsonb) from public.inventory),
    'invoice_state', (select coalesce(jsonb_agg(jsonb_build_array(id,organization_id,branch_id,status,updated_at) order by id),'[]'::jsonb) from public.invoices),
    'customer_ledger', (select jsonb_build_array(count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)) from public.customer_ledger_entries),
    'vendor_ledger', (select jsonb_build_array(count(*),coalesce(sum(debit),0),coalesce(sum(credit),0)) from public.vendor_payable_ledger_entries),
    'journals', (select count(*) from public.journal_entries),
    'journal_lines', (select count(*) from public.journal_lines)
  );
$$;

-- Deterministic isolated fixtures. Existing rows are not used or reassigned.
insert into auth.users(id,email,created_at,updated_at) values
  ('10000000-0000-4000-8000-000000000001','actor-a@local.invalid',now(),now()),
  ('10000000-0000-4000-8000-000000000002','actor-b@local.invalid',now(),now());
insert into public.organizations(id,name,slug) values
  ('20000000-0000-4000-8000-000000000001','Organization A','organization-a'),
  ('20000000-0000-4000-8000-000000000002','Organization B','organization-b');
insert into public.organization_memberships(organization_id,user_id,role,status) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','active'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','owner','active');
insert into public.branches(id,organization_id,code,name,status) values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','A1','Organization A Branch 1','active'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','A2','Organization A Branch 2','active'),
  ('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','B1','Organization B Branch 1','active');
insert into public.branch_access_grants(organization_id,branch_id,user_id,status) values
  ('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','active'),
  ('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','active');

insert into public.customers(name,phone,city,organization_id) values
  ('Customer A','n/a','local','20000000-0000-4000-8000-000000000001'),
  ('Customer B','n/a','local','20000000-0000-4000-8000-000000000002'),
  ('Unowned Customer','n/a','local',null);
insert into public.vendors(name,phone,city,organization_id) values
  ('Vendor A','n/a','local','20000000-0000-4000-8000-000000000001'),
  ('Vendor B','n/a','local','20000000-0000-4000-8000-000000000002'),
  ('Unowned Vendor','n/a','local',null);
insert into public.warehouses(name,location,organization_id) values
  ('Warehouse A','local','20000000-0000-4000-8000-000000000001'),
  ('Warehouse B','local','20000000-0000-4000-8000-000000000002'),
  ('Unowned Warehouse','local',null);
insert into public.products(name,sku,category,unit,purchase_price,sale_price,organization_id) values
  ('Product A','P0-A','test','unit',10,10,'20000000-0000-4000-8000-000000000001'),
  ('Product B','P0-B','test','unit',10,10,'20000000-0000-4000-8000-000000000002'),
  ('Unowned Product','P0-U','test','unit',10,10,null);
insert into public.inventory(organization_id,product_id,warehouse_id,quantity)
values ('20000000-0000-4000-8000-000000000001',1,1,100);

grant all on function pg_temp.assert_true(boolean,text) to service_role;
grant execute on function pg_temp.transaction_snapshot() to service_role;

-- Establish three P0-8 invoices through the canonical sales boundary.
set role service_role;
select public.post_invoice_atomic(
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','muraderp-regression','sales.invoice.post',
  'fixture-invoice-payment','a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  '{"invoice_number":"INV-PAY-50","customer_id":1,"source_type":"DIRECT","issue_date":"2026-09-02","currency_code":"PKR","subtotal":50,"discount_total":0,"grand_total":50,"pass_through_rent":0}'::jsonb,
  '[{"line_number":1,"product_id":1,"quantity":5,"unit":"unit","unit_price":10,"line_total":50,"unit_cost":6,"cogs_total":30,"pricing_source":"MANUAL_OVERRIDE"}]'::jsonb,1
);
select public.post_invoice_atomic(
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','muraderp-regression','sales.invoice.post',
  'fixture-invoice-return','b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
  '{"invoice_number":"INV-RETURN-40","customer_id":1,"source_type":"DIRECT","issue_date":"2026-09-02","currency_code":"PKR","subtotal":40,"discount_total":0,"grand_total":40,"pass_through_rent":0}'::jsonb,
  '[{"line_number":1,"product_id":1,"quantity":4,"unit":"unit","unit_price":10,"line_total":40,"unit_cost":6,"cogs_total":24,"pricing_source":"MANUAL_OVERRIDE"}]'::jsonb,1
);
select public.post_invoice_atomic(
  '20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','muraderp-regression','sales.invoice.post',
  'fixture-invoice-concurrency','c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
  '{"invoice_number":"INV-CONCURRENT-30","customer_id":1,"source_type":"DIRECT","issue_date":"2026-09-02","currency_code":"PKR","subtotal":30,"discount_total":0,"grand_total":30,"pass_through_rent":0}'::jsonb,
  '[{"line_number":1,"product_id":1,"quantity":3,"unit":"unit","unit_price":10,"line_total":30,"unit_cost":6,"cogs_total":18,"pricing_source":"MANUAL_OVERRIDE"}]'::jsonb,1
);
reset role;

select pg_temp.assert_true((select count(*)=3 from public.invoices where organization_id='20000000-0000-4000-8000-000000000001' and branch_id='30000000-0000-4000-8000-000000000001'),'P0-8 invoice fixture scope');

-- Authorized purchase and its replay/fingerprint contract.
set role service_role;
select public.record_purchase(
  p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',
  p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'purchase.create',
  p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":5,"unit_cost":10}]',p_idempotency_key=>'purchase-50',
  p_request_fingerprint=>'1111111111111111111111111111111111111111111111111111111111111111',p_purchase_date=>'2026-09-02',p_invoice_number=>'SUP-50'
);
select public.record_purchase(
  p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',
  p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'purchase.create',
  p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":5,"unit_cost":10}]',p_idempotency_key=>'purchase-50',
  p_request_fingerprint=>'1111111111111111111111111111111111111111111111111111111111111111',p_purchase_date=>'2026-09-02',p_invoice_number=>'SUP-50'
);
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin
    perform public.record_purchase(
      p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',
      p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'purchase.create',
      p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":5,"unit_cost":10}]',p_idempotency_key=>'purchase-50',
      p_request_fingerprint=>'9999999999999999999999999999999999999999999999999999999999999999');
    raise exception 'expected purchase fingerprint rejection';
  exception when sqlstate 'P0001' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase fingerprint rejection side effects');
end $$;
reset role;

select pg_temp.assert_true((select count(*)=1 from public.purchases),'purchase persisted once');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source_type='PURCHASE' and status='POSTED'),'purchase authoritative journal once');
select pg_temp.assert_true((select count(*)=1 from public.vendor_payable_ledger_entries where entry_type='PURCHASE' and credit=50 and organization_id='20000000-0000-4000-8000-000000000001' and branch_id='30000000-0000-4000-8000-000000000001'),'purchase AP credit');

set role service_role;
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin
    perform public.record_purchase(
      p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',
      p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'purchase.create',
      p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":1,"unit_cost":10}]',p_idempotency_key=>'purchase-duplicate-invoice',
      p_request_fingerprint=>repeat('2',64),p_invoice_number=>' sup-50 '
    );
    raise exception 'expected duplicate invoice rejection';
  exception when sqlstate 'P0002' then null;
  end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'duplicate purchase invoice side effects');
end $$;
reset role;

-- Authorization/ownership rejection matrix. Every block compares the entire
-- transaction-side-effect snapshot before and after the rejected call.
set role service_role;
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_purchase('20000000-0000-4000-8000-000000000002'::uuid,'30000000-0000-4000-8000-000000000003'::uuid,'10000000-0000-4000-8000-000000000001'::uuid,'muraderp-regression','purchase.create',1,1,'[{"product_id":1,"quantity":1,"unit_cost":10}]','purchase-wrong-org',repeat('2',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase cross-organization side effects');
  begin perform public.record_purchase('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000001'::uuid,'muraderp-regression','purchase.create',1,1,'[{"product_id":1,"quantity":1,"unit_cost":10}]','purchase-wrong-branch',repeat('3',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase unauthorized branch side effects');
  begin perform public.record_purchase('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,null::uuid,'muraderp-regression','purchase.create',1,1,'[{"product_id":1,"quantity":1,"unit_cost":10}]','purchase-no-actor',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase missing actor side effects');
  begin perform public.record_purchase(p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>null,p_operation_scope=>'purchase.create',p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":1,"unit_cost":10}]',p_idempotency_key=>'purchase-no-principal',p_request_fingerprint=>repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase missing service principal side effects');
  begin perform public.record_purchase(p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'sales-return.create',p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":1,"unit_cost":10}]',p_idempotency_key=>'purchase-wrong-operation',p_request_fingerprint=>repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase wrong operation side effects');
  begin perform public.record_purchase('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000001'::uuid,'service_role','purchase.create',1,1,'[{"product_id":1,"quantity":1,"unit_cost":10}]','purchase-invalid-principal',repeat('5',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase invalid principal side effects');
  begin perform public.record_purchase('20000000-0000-4000-8000-000000000001'::uuid,'30000000-0000-4000-8000-000000000001'::uuid,'10000000-0000-4000-8000-000000000001'::uuid,'muraderp-regression','purchase.create',3,1,'[{"product_id":1,"quantity":1,"unit_cost":10}]','purchase-unowned',repeat('6',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'purchase unowned vendor side effects');
end $$;

do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-wrong-org',repeat('2',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment cross-organization side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-wrong-branch',repeat('3',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment unauthorized branch side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-no-actor',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment missing actor side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-no-principal',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment missing service principal side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','purchase.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-wrong-operation',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment wrong operation side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','default','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-invalid-principal',repeat('5',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment invalid principal side effects');
  begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',3,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','cp-unowned',repeat('6',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment unowned customer side effects');
end $$;

do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-XORG',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-wrong-org',repeat('2',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return cross-organization side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-BRANCH',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-wrong-branch',repeat('3',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return unauthorized branch side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'muraderp-regression','sales-return.create','CN-NOACTOR',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-no-actor',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return missing actor side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'sales-return.create','CN-NOPRINCIPAL',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-no-principal',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return missing service principal side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create','CN-WRONGOP',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-wrong-operation',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return wrong operation side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','backend','sales-return.create','CN-BADP',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":1}]','sr-invalid-principal',repeat('5',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return invalid principal side effects');
  begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-UNOWNED',2,1,'2026-09-02','PKR','return',null,'[{"invoice_item_id":2,"warehouse_id":3,"quantity":1}]','sr-unowned',repeat('6',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return unowned warehouse side effects');
end $$;

do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-wrong-org',repeat('2',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment cross-organization side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-wrong-branch',repeat('3',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment unauthorized branch side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',null,'muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-no-actor',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment missing actor side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',null,'vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-no-principal',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment missing service principal side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-wrong-operation',repeat('4',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment wrong operation side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','internal-system','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-invalid-principal',repeat('5',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment invalid principal side effects');
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',3,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vp-unowned',repeat('6',64)); raise exception 'expected'; exception when sqlstate '42501' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment unowned vendor side effects');
end $$;

-- Authorized customer payment, sales return, and vendor payment with exact
-- replay and fingerprint-mismatch rejection.
select public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','customer-payment-20',repeat('7',64));
select public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','customer-payment-20',repeat('7',64));
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin begin perform public.record_customer_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','customer-payment.create',1,'2026-09-02',20,'PKR','CASH',null,null,'[{"invoice_id":1,"amount":20}]','customer-payment-20',repeat('8',64)); raise exception 'expected'; exception when sqlstate 'P0001' then null; end; perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'customer payment fingerprint side effects'); end $$;

select public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-20',2,1,'2026-09-02','PKR','Damaged',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":2}]','sales-return-20',repeat('9',64));
select public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-20',2,1,'2026-09-02','PKR','Damaged',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":2}]','sales-return-20',repeat('9',64));
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin begin perform public.record_sales_return('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','sales-return.create','CN-20',2,1,'2026-09-02','PKR','Damaged',null,'[{"invoice_item_id":2,"warehouse_id":1,"quantity":2}]','sales-return-20',repeat('a',64)); raise exception 'expected'; exception when sqlstate 'P0001' then null; end; perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'sales return fingerprint side effects'); end $$;

select public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vendor-payment-20',repeat('b',64));
select public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vendor-payment-20',repeat('b',64));
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,20,'CASH','[{"purchase_id":1,"amount":20}]','2026-09-02',null,null,'vendor-payment-20',repeat('c',64)); raise exception 'expected'; exception when sqlstate 'P0001' then null; end; perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'vendor payment fingerprint side effects'); end $$;
reset role;

-- Reconciliation and ownership assertions.
select pg_temp.assert_true((select count(*)=1 from public.customer_payments where organization_id='20000000-0000-4000-8000-000000000001' and branch_id='30000000-0000-4000-8000-000000000001' and actor_user_id='10000000-0000-4000-8000-000000000001'),'customer payment scoped once');
select pg_temp.assert_true((select count(*)=1 from public.credit_notes where organization_id='20000000-0000-4000-8000-000000000001' and branch_id='30000000-0000-4000-8000-000000000001' and actor_user_id='10000000-0000-4000-8000-000000000001'),'sales return scoped once');
select pg_temp.assert_true((select count(*)=1 from public.vendor_payments where organization_id='20000000-0000-4000-8000-000000000001' and branch_id='30000000-0000-4000-8000-000000000001' and actor_user_id='10000000-0000-4000-8000-000000000001'),'vendor payment scoped once');
select pg_temp.assert_true((select outstanding_balance=30 from public.vendor_payable_balances where vendor_id=1),'vendor payable 50 minus 20 equals 30');
select pg_temp.assert_true((select coalesce(sum(debit-credit),0)=80 from public.customer_ledger_entries where customer_id=1 and organization_id='20000000-0000-4000-8000-000000000001'),'AR subledger reconciles invoices 120 minus payment 20 minus return 20');
select pg_temp.assert_true((select coalesce(sum(jl.debit-jl.credit),0)=80 from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.accounts a on a.id=jl.account_id where je.organization_id='20000000-0000-4000-8000-000000000001' and je.status='POSTED' and a.code='1100'),'AR subledger reconciles to authoritative GL');
select pg_temp.assert_true((select coalesce(sum(jl.credit-jl.debit),0)=30 from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.accounts a on a.id=jl.account_id where je.organization_id='20000000-0000-4000-8000-000000000001' and je.status='POSTED' and a.code='2000'),'AP subledger reconciles to authoritative GL');
select pg_temp.assert_true((select quantity=95 from public.inventory where product_id=1 and warehouse_id=1 and organization_id='20000000-0000-4000-8000-000000000001'),'inventory reconciles sales, purchase, and return');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source_type='CUSTOMER_PAYMENT' and status='POSTED'),'customer payment GL once');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source_type='CREDIT_NOTE' and status='POSTED'),'sales return GL once');
select pg_temp.assert_true((select count(*)=1 from public.journal_entries where source_type='VENDOR_PAYMENT' and status='POSTED'),'vendor payment GL once');
select pg_temp.assert_true((select coalesce(sum(jl.debit-jl.credit),0)=0 from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id where je.source_type in ('PURCHASE','CUSTOMER_PAYMENT','CREDIT_NOTE','VENDOR_PAYMENT')),'all four non-sales journals balance');
select pg_temp.assert_true((select count(*)=0 from public.accounting_journal_entries where source_type in ('PURCHASE','CUSTOMER_PAYMENT','CREDIT_NOTE','VENDOR_PAYMENT')),'no legacy journal writes');

-- Forced late accounting failure: payment/AP writes occur before journal insert,
-- so a journal trigger failure proves the enclosing RPC rolls all of them back.
create or replace function pg_temp.fail_vendor_payment_journal() returns trigger language plpgsql as $$
begin
  if new.source_type='VENDOR_PAYMENT' and new.idempotency_key='rollback-accounting' then
    raise exception using errcode='P0099', message='forced accounting failure';
  end if;
  return new;
end $$;
create trigger p0_test_fail_vendor_journal before insert on public.journal_entries for each row execute function pg_temp.fail_vendor_payment_journal();
set role service_role;
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_vendor_payment('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','muraderp-regression','vendor-payment.create',1,5,'CASH','[{"purchase_id":1,"amount":5}]','2026-09-02',null,null,'rollback-accounting',repeat('d',64)); raise exception 'expected'; exception when sqlstate 'P0099' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'forced accounting failure rollback');
end $$;
reset role;
drop trigger p0_test_fail_vendor_journal on public.journal_entries;

-- Forced inventory/stock failure after purchase header/items proves atomic rollback.
create or replace function pg_temp.fail_purchase_stock() returns trigger language plpgsql as $$
begin
  if new.movement_type='PURCHASE' and new.notes='rollback-inventory' then
    raise exception using errcode='P0098', message='forced inventory failure';
  end if;
  return new;
end $$;
create trigger p0_test_fail_purchase_stock before insert on public.stock_movements for each row execute function pg_temp.fail_purchase_stock();
set role service_role;
do $$ declare b jsonb:=pg_temp.transaction_snapshot(); begin
  begin perform public.record_purchase(p_organization_id=>'20000000-0000-4000-8000-000000000001',p_branch_id=>'30000000-0000-4000-8000-000000000001',p_actor_user_id=>'10000000-0000-4000-8000-000000000001',p_service_principal=>'muraderp-regression',p_operation_scope=>'purchase.create',p_vendor_id=>1,p_warehouse_id=>1,p_items=>'[{"product_id":1,"quantity":1,"unit_cost":10}]',p_idempotency_key=>'rollback-inventory',p_request_fingerprint=>repeat('e',64),p_notes=>'rollback-inventory'); raise exception 'expected'; exception when sqlstate 'P0098' then null; end;
  perform pg_temp.assert_true(pg_temp.transaction_snapshot()=b,'forced inventory failure rollback');
end $$;
reset role;
drop trigger p0_test_fail_purchase_stock on public.stock_movements;

-- Privilege boundary: old writers and direct table DML remain unreachable.
select pg_temp.assert_true(not has_function_privilege('service_role','public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)','EXECUTE'),'legacy purchase RPC revoked');
select pg_temp.assert_true(not has_function_privilege('service_role','public.record_customer_payment_p0_6_impl(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text)','EXECUTE'),'customer payment implementation revoked');
select pg_temp.assert_true(not has_function_privilege('service_role','public.record_vendor_payment_p0_6_impl(bigint,numeric,text,jsonb,date,text,text,text,text,text)','EXECUTE'),'vendor payment implementation revoked');
select pg_temp.assert_true(not has_function_privilege('service_role','public.record_sales_return_p0_6_impl(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text)','EXECUTE'),'sales return implementation revoked');
select pg_temp.assert_true(not has_table_privilege('service_role','public.journal_entries','INSERT'),'direct authoritative journal insert revoked');
select pg_temp.assert_true(not has_table_privilege('service_role','public.purchases','INSERT'),'direct purchase insert revoked');

select 'P0_NON_SALES_CONVERGENCE_REGRESSION_PASS' as result;
