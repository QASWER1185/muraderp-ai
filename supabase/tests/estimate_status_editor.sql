\set ON_ERROR_STOP on
begin;
do $$
declare
 org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); denied uuid:=gen_random_uuid();
 customer bigint; product bigint; foreign_product bigint; other_org uuid:=gen_random_uuid(); source bigint; stamp timestamptz; snapshot jsonb;
begin
 insert into auth.users(id,email) values(actor,actor::text||'@local.invalid');
 insert into public.organizations(id,name,slug) values(org,'Editor test',org::text),(other_org,'Other',other_org::text);
 insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
 insert into public.branches(id,organization_id,code,name,status) values(branch,org,'MAIN','Main','active'),(denied,org,'DENIED','Denied','active');
 insert into public.branch_access_grants(organization_id,branch_id,user_id,status) values(org,branch,actor,'active');
 insert into public.customers(organization_id,name,phone,city) values(org,'Editor customer','0','Test') returning id into customer;
 insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(org,'Editor pipe','PIPE','Pipes','pcs',1,100) returning id into product;
 insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(other_org,'Foreign','PIPE','Pipes','pcs',1,100) returning id into foreign_product;
 set local role service_role;
 snapshot:=public.create_estimate_atomic(jsonb_build_object('organization_id',org,'branch_id',branch,'customer_id',customer,'estimate_number',org::text,'issue_date','2026-10-24','currency_code','PKR'),jsonb_build_array(jsonb_build_object('line_number',1,'product_id',product,'quantity',2,'unit','pcs','unit_price',100,'discount_amount',0,'pricing_source','MANUAL_OVERRIDE')),'MANUAL',null,branch,actor,'editor-test');
 source:=(snapshot->'estimate'->>'id')::bigint;
 select updated_at into stamp from public.estimates where id=source;
 begin
  perform public.update_estimate_scoped(org,denied,actor,source,jsonb_build_object('expected_updated_at',stamp,'status','READY'));
  raise exception 'ASSERT: cross-branch update succeeded';
 exception when insufficient_privilege then null;end;
 begin
  perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'notes','changed','lines',jsonb_build_array(jsonb_build_object('product_id',foreign_product,'quantity',1,'unit','pcs','unit_price',2))));
  raise exception 'ASSERT: foreign product update succeeded';
 exception when raise_exception then if sqlerrm like 'ASSERT:%' then raise;end if;end;
 if (select count(*) from public.estimate_items where estimate_id=source)<>1 or (select notes from public.estimates where id=source) is not null then raise exception 'ASSERT: failed edit was not atomic';end if;
 perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'notes','reviewed','lines',jsonb_build_array(jsonb_build_object('product_id',product,'quantity',3,'unit','pcs','unit_price',100,'discount_amount',30))));
 if (select line_amount from public.estimate_items where estimate_id=source)<>270 then raise exception 'ASSERT: line totals wrong';end if;
 begin
  perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'status','READY'));
  raise exception 'ASSERT: stale concurrency version succeeded';
 exception when serialization_failure then null;end;
 select updated_at into stamp from public.estimates where id=source;
 perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'status','READY'));
 if (select status from public.estimates where id=source)<>'READY' then raise exception 'ASSERT: READY transition failed';end if;
 select updated_at into stamp from public.estimates where id=source;
 begin
  perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'status','INVOICED'));
  raise exception 'ASSERT: bypassed invoice posting';
 exception when raise_exception then if sqlerrm like 'ASSERT:%' then raise;end if;end;
 perform public.update_estimate_scoped(org,branch,actor,source,jsonb_build_object('expected_updated_at',stamp,'status','CANCELLED'));
 if (select status from public.estimates where id=source)<>'CANCELLED' then raise exception 'ASSERT: cancel failed';end if;
end $$;
rollback;
