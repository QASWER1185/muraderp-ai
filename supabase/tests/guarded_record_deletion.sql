begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c bigint; p bigint; e bigint; v bigint; l bigint;
begin
  insert into auth.users(id,email) values(actor,actor||'@test.invalid');
  insert into public.organizations(id,name,slug) values(org,'Delete test',org::text);
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
  insert into public.branches(id,organization_id,code,name,status) values(b,org,'D','Delete branch','active');
  insert into public.customers(organization_id,name,phone,city) values(org,'Unused','0','Test') returning id into c;
  if public.delete_unused_record('customers',c,gen_random_uuid(),b,actor) then raise exception 'Foreign tenant deleted'; end if;
exception when insufficient_privilege then
  -- Continue tenant test in a subtransaction below; this block rolls back setup.
end $$;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c bigint; p bigint; e bigint; v bigint; l bigint;
begin
  insert into auth.users(id,email) values(actor,actor||'@test.invalid');
  insert into public.organizations(id,name,slug) values(org,'Delete test',org::text);
  insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
  insert into public.branches(id,organization_id,code,name,status) values(b,org,'D','Delete branch','active');
  insert into public.customers(organization_id,name,phone,city) values(org,'Unused','0','Test') returning id into c;
  if not public.delete_unused_record('customers',c,org,b,actor) then raise exception 'Unused customer not deleted'; end if;
  if exists(select 1 from public.customers where id=c) then raise exception 'Customer still present'; end if;
  if not exists(select 1 from public.record_deletion_events where entity='customers' and record_id=c) then raise exception 'Missing audit'; end if;
  insert into public.customers(organization_id,name,phone,city) values(org,'Linked','0','Test') returning id into c;
  insert into public.estimates(organization_id,branch_id,customer_id,estimate_number,issue_date,currency_code,status) values(org,b,c,'DELETE-DRAFT',current_date,'PKR','DRAFT') returning id into e;
  begin
    perform public.delete_unused_record('customers',c,org,b,actor);
    raise exception 'Linked customer deleted';
  exception when check_violation then null; end;
  if not public.delete_unused_record('estimates',e,org,b,actor) then raise exception 'Draft estimate not deleted'; end if;
  insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code) values(org,'Delete rates','DEL','SALE','GLOBAL','PKR') returning id into l;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(l,1,'DRAFT',current_date) returning id into v;
  if not public.delete_unused_record('rate_list_versions',v,org,b,actor) then raise exception 'Draft version not deleted'; end if;
  insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(l,2,'ACTIVE',current_date) returning id into v;
  begin perform public.delete_unused_record('rate_list_versions',v,org,b,actor);raise exception 'Active version deleted';exception when check_violation then null;end;
end $$;
rollback;
