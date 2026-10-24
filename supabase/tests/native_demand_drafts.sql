\set ON_ERROR_STOP on
begin;
do $$
declare
 org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); action uuid:=gen_random_uuid();
 customer bigint; product bigint; saved jsonb; again jsonb; plan jsonb; eid bigint;
begin
 insert into auth.users(id,email) values(actor,actor::text||'@local.invalid');
 insert into public.organizations(id,name,slug) values(org,'Demand test',org::text);
 insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
 insert into public.branches(id,organization_id,code,name,status) values(branch,org,'MAIN','Main','active');
 insert into public.branch_access_grants(organization_id,branch_id,user_id,status) values(org,branch,actor,'active');
 insert into public.customers(organization_id,name,phone,city) values(org,'Demand customer','0','Test') returning id into customer;
 insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(org,'Medium pipe','PIPE','Pipes','length',1,100) returning id into product;
 plan:=jsonb_build_object('branchId',branch,'unifiedAction',jsonb_build_object('tool','erp_create_estimate','data',jsonb_build_object(
  'mode','DEMAND_SLIP_ESTIMATE','customerId',customer,'date','2026-10-24','lines',jsonb_build_array(
   jsonb_build_object('product_id',product,'productName','Medium pipe','quantity',4,'unit','length','unit_price',100,'discount_amount',200,'discountPercent',50,'pricing_source','RESOLVED_RATE'),
   jsonb_build_object('productName','Thread','quantity',8,'unit','pcs','pending',true,'hardware',true)))));
 insert into public.ai_copilot_actions(id,organization_id,user_id,intent,idempotency_key,request_fingerprint,action_plan)
  values(action,org,actor,'estimate','demand-test',repeat('a',64),plan);
 set local role service_role;
 saved:=public.save_copilot_demand_estimate(org,branch,actor,action);eid:=(saved->>'id')::bigint;
 again:=public.save_copilot_demand_estimate(org,branch,actor,action);
 if eid<>(again->>'id')::bigint or (select count(*) from public.estimate_items where estimate_id=eid)<>2 then raise exception 'ASSERT replay duplicated draft or lines';end if;
 if (select sum(line_amount) from public.estimate_items where estimate_id=eid)<>200 then raise exception 'ASSERT priced subtotal wrong';end if;
 if not exists(select 1 from public.estimate_items where estimate_id=eid and is_pending and is_unlisted and product_id is null and unit_price=0 and quantity=8 and unit='pcs') then raise exception 'ASSERT pending source lost';end if;
 begin
  update public.estimates set status='READY' where id=eid;
  raise exception 'ASSERT pending draft became READY';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.save_copilot_demand_estimate(org,gen_random_uuid(),actor,action);
  raise exception 'ASSERT cross branch allowed';
 exception when insufficient_privilege then null;end;
 -- A retained follow-up updates the same native estimate, never adds a bill.
 update public.ai_copilot_actions set action_plan=jsonb_set(action_plan,'{unifiedAction,data,lines,0,quantity}','6'::jsonb) where id=action;
 perform public.save_copilot_demand_estimate(org,branch,actor,action);
 if not exists(select 1 from public.estimate_items where estimate_id=eid and line_number=1 and quantity=6) then raise exception 'ASSERT follow-up did not update same estimate';end if;
 if exists(select 1 from public.invoices where organization_id=org) or exists(select 1 from public.stock_movements where organization_id=org) then raise exception 'ASSERT draft caused financial posting';end if;
end $$;
rollback;
