-- Local/disposable database only. Fixtures and transaction results roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'ASSERTION FAILED: %', message; end if; end $$;
grant execute on function pg_temp.check_true(boolean,text) to service_role;

do $$
declare
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid(); actor uuid := gen_random_uuid();
  branch uuid := gen_random_uuid(); denied_branch uuid := gen_random_uuid();
  customer bigint; foreign_customer bigint; product bigint; foreign_product bigint;
  list_id bigint; target_list bigint; version_id bigint; target_version bigint; item_id bigint; target_item bigint;
  definition jsonb; lines jsonb; result jsonb; replay jsonb; source jsonb; conversion jsonb;
  clone_definition jsonb; clone_lines jsonb; source_id bigint; before_count bigint; before_keys bigint;
begin
  insert into auth.users(id,email) values(actor, actor::text || '@local.invalid');
  insert into public.organizations(id,name,slug) values (org,'Estimate Test',org::text),(other_org,'Other Estimate Test',other_org::text);
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
  insert into public.branches(id,organization_id,code,name,status) values (branch,org,'E1','Estimate Branch','active'),(denied_branch,org,'E2','Denied Branch','active');
  insert into public.branch_access_grants(organization_id,branch_id,user_id,status) values(org,branch,actor,'active');
  insert into public.customers(organization_id,name,phone,city) values(org,'Customer','0','Test') returning id into customer;
  insert into public.customers(organization_id,name,phone,city) values(other_org,'Other','0','Test') returning id into foreign_customer;
  insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(org,'Canonical Product','EST-TEST','Test','piece',1,10) returning id into product;
  insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(other_org,'Foreign Product','EST-TEST','Test','piece',1,10) returning id into foreign_product;
  insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code) values(org,'Company A','A','SALE','GLOBAL','PKR') returning id into list_id;
  insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code) values(org,'Company B','B','SALE','GLOBAL','PKR') returning id into target_list;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(list_id,1,'ACTIVE','2026-01-01') returning id into version_id;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(target_list,1,'ACTIVE','2026-01-01') returning id into target_version;
  insert into public.rate_list_items(rate_list_version_id,product_id,minimum_quantity,unit_price,unit) values(version_id,product,1,10,'piece') returning id into item_id;
  insert into public.rate_list_items(rate_list_version_id,product_id,minimum_quantity,unit_price,unit) values(target_version,product,1,20,'piece') returning id into target_item;
  definition := jsonb_build_object('organization_id',org,'customer_id',customer,'branch_id',branch,'estimate_number',org::text || '-source','issue_date','2026-09-08','currency_code','PKR','layout_key','COMPACT_TRADE','notes','keep','pass_through_rent',12,'pass_through_rent_payee','Carrier');
  lines := jsonb_build_array(jsonb_build_object('line_number',1,'product_id',product,'description','keep description','quantity',25,'unit','piece','unit_price',10,'discount_amount',5,'pricing_source','RESOLVED_RATE','rate_list_id',list_id,'rate_list_version_id',version_id,'brand_hint','Company A','rate_list_selection_source','LINE_OVERRIDE'));
  set local role service_role;
  result := public.create_estimate_atomic(definition,lines,'MANUAL',null,branch,actor,'create-source');
  source_id := (result->'estimate'->>'id')::bigint;
  replay := public.create_estimate_atomic(definition,lines,'MANUAL',null,branch,actor,'create-source');
  perform pg_temp.check_true(result = replay,'atomic retry returns identical snapshot');
  perform pg_temp.check_true((select count(*) = 1 from public.estimates where organization_id = org),'one source created');
  perform pg_temp.check_true((result->'estimate'->>'branch_id')::uuid = branch,'durable branch');
  perform pg_temp.check_true(result->'estimate'->>'layout_key' = 'COMPACT_TRADE','layout persisted');
  source := public.estimate_conversion_snapshot(source_id,org);
  conversion := jsonb_build_object('source_estimate_id',source_id,'mode','REPRICE_ALL_TO_TARGET_RATE_LIST','target_rate_list_id',target_list,'pricing_date','2026-09-08','preview_fingerprint',repeat('a',64));
  clone_definition := definition || jsonb_build_object('estimate_number',org::text || '-clone','conversion_request',conversion,'source_fingerprint',source->>'source_fingerprint');
  clone_lines := jsonb_build_array(lines->0 || jsonb_build_object('unit_price',20,'rate_list_id',target_list,'rate_list_version_id',target_version,'brand_hint',null,'resolved_price',jsonb_build_object('rate_list_item_id',target_item)));
  result := public.create_estimate_atomic(clone_definition,clone_lines,'MANUAL','estimate-clone:'||source_id,branch,actor,'clone');
  replay := public.create_estimate_atomic(clone_definition,clone_lines,'MANUAL','estimate-clone:'||source_id,branch,actor,'clone');
  perform pg_temp.check_true(result = replay,'clone idempotent replay');
  perform pg_temp.check_true((result->'estimate'->>'id')::bigint <> source_id,'clone creates new estimate');
  perform pg_temp.check_true(public.estimate_conversion_snapshot(source_id,org) = source,'source unchanged including timestamps');
  perform pg_temp.check_true((result->'items'->0->>'unit_price')::numeric = 20,'target price persisted');
  perform pg_temp.check_true((result->'items'->0->>'quantity')::numeric = 25,'quantity preserved');
  perform pg_temp.check_true(result->'items'->0->>'description' = 'keep description','description preserved');
  perform pg_temp.check_true((result->'items'->0->>'discount_amount')::numeric = 5,'discount preserved');
  perform pg_temp.check_true(result->'items'->0->'pricing_provenance'->'resolved_price'->>'rate_list_item_id' = target_item::text,'rate provenance');
  select count(*) into before_count from public.estimates where organization_id = org;
  select count(*) into before_keys from public.estimate_idempotency_keys where organization_id = org;
  begin
    perform public.create_estimate_atomic(definition || '{"estimate_number":"changed"}',lines,'MANUAL',null,branch,actor,'create-source');
    raise exception 'expected idempotency conflict';
  exception when unique_violation then null; end;
  -- Second line fails after header + first line were inserted: all must roll back.
  begin
    perform public.create_estimate_atomic(definition || jsonb_build_object('estimate_number',org::text||'-failure'),lines || jsonb_build_array(lines->0 || '{"line_number":2,"discount_amount":999999}'),'MANUAL',null,branch,actor,'failure');
    raise exception 'expected failed second line';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.check_true((select count(*) = before_count from public.estimates where organization_id = org),'failed line leaves no orphan header');
  perform pg_temp.check_true((select count(*) = before_keys from public.estimate_idempotency_keys where organization_id = org),'failed line leaves no idempotency reservation');
  begin
    perform public.create_estimate_atomic(definition || jsonb_build_object('customer_id',foreign_customer),lines,'MANUAL',null,branch,actor,'foreign-customer');
    raise exception 'expected foreign customer rejection';
  exception when foreign_key_violation then null; end;
  begin
    perform public.create_estimate_atomic(definition,jsonb_build_array(lines->0 || jsonb_build_object('product_id',foreign_product)),'MANUAL',null,branch,actor,'foreign-product');
    raise exception 'expected foreign product rejection';
  exception when foreign_key_violation then null; end;
  begin
    perform public.create_estimate_atomic(definition,lines,'MANUAL',null,denied_branch,actor,'denied-branch');
    raise exception 'expected branch rejection';
  exception when insufficient_privilege then null; end;
  begin
    perform public.create_estimate_atomic(clone_definition || '{"source_fingerprint":"stale"}',clone_lines,'MANUAL',null,branch,actor,'stale');
    raise exception 'expected stale source rejection';
  exception when serialization_failure then null; end;
  begin
    perform public.create_estimate_atomic(clone_definition,jsonb_build_array(clone_lines->0 || '{"unit_price":999}'),'MANUAL',null,branch,actor,'tamper');
    raise exception 'expected price tamper rejection';
  exception when serialization_failure then null; end;
  perform pg_temp.check_true((select count(*) = before_count from public.estimates where organization_id = org),'rejections leave no estimates');
  perform pg_temp.check_true((select count(*) = before_keys from public.estimate_idempotency_keys where organization_id = org),'rejections leave no keys');
  reset role;
  perform pg_temp.check_true(not has_function_privilege('authenticated','public.create_estimate_atomic(jsonb,jsonb,text,text,uuid,uuid,text)','EXECUTE'),'browser RPC blocked');
  perform pg_temp.check_true(not has_function_privilege('anon','public.estimate_conversion_snapshot(bigint,uuid)','EXECUTE'),'anonymous snapshots blocked');
  perform pg_temp.check_true(not has_table_privilege('authenticated','public.estimate_idempotency_keys','SELECT'),'browser cannot read audit/replay data');
  raise notice 'Estimate atomicity, clone preservation, pricing validation, idempotency and authorization PASS';
end $$;
rollback;
