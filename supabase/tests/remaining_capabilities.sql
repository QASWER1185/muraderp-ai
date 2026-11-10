begin;
do $$
declare org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); list_id bigint; other_list bigint; version_id bigint; product bigint; customer bigint; estimate bigint; saved jsonb;
begin
 insert into auth.users(id) values(actor);
 insert into public.organizations(id,name,slug) values(org,'Remaining test',org::text);
 insert into public.organization_memberships(organization_id,user_id,role,status) values(org,actor,'owner','active');
 insert into public.branches(id,organization_id,code,name,status) values(branch,org,'T','Test','active');
 insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code) values(org,'Test','TEST','SALE','GLOBAL','PKR') returning id into list_id;
 insert into public.rate_lists(organization_id,name,code,price_type,scope_type,currency_code) values(org,'Other','OTHER','SALE','GLOBAL','PKR') returning id into other_list;
 insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(list_id,1,'DRAFT',current_date) returning id into version_id;
 if public.delete_rate_list_version_scoped(other_list,version_id,org,branch,actor) then raise exception 'Wrong parent deleted version';end if;
 if not public.delete_rate_list_version_scoped(list_id,version_id,org,branch,actor) then raise exception 'Draft version not deleted';end if;
 insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(list_id,2,'ACTIVE',current_date) returning id into version_id;
 begin perform public.delete_rate_list_version_scoped(list_id,version_id,org,branch,actor);raise exception 'Active version deleted';exception when check_violation then null;end;
 insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price) values(org,'Test',org::text,'Test','piece',1,2) returning id into product;
 insert into public.customers(organization_id,name,phone,city) values(org,'Test','0','Test') returning id into customer;
 insert into public.estimates(organization_id,branch_id,customer_id,estimate_number,issue_date) values(org,branch,customer,'TEST-REF',current_date) returning id into estimate;
 insert into public.rate_list_versions(rate_list_id,version_number,status,effective_from) values(list_id,3,'DRAFT',current_date) returning id into version_id;
 insert into public.estimate_items(estimate_id,line_number,product_id,quantity,unit,unit_price,rate_list_version_id) values(estimate,1,product,1,'piece',2,version_id);
 begin perform public.delete_rate_list_version_scoped(list_id,version_id,org,branch,actor);raise exception 'Referenced version deleted';exception when check_violation then null;end;
 saved:=public.save_organization_settings(org,actor,'{"company":{"name":"Qaswer","currency":"PKR","tax_registration":"TAX-1"},"numbering":{"estimate":{"prefix":"EST-","next":1071}}}');
 saved:=public.save_organization_settings(org,actor,'{"company":{"phone":"123"},"numbering":{"estimate":{"prefix":"EST2-"}}}');
 if saved->'company'->>'name'<>'Qaswer' or saved->'numbering'->'estimate'->>'next'<>'1071' then raise exception 'Partial save lost settings';end if;
 begin perform public.save_organization_settings(org,actor,'{"company":{"phone":"BAD"},"invalid":{}}');raise exception 'Invalid settings section accepted';exception when invalid_parameter_value then null;end;
 if (select value->>'phone' from public.organization_settings where organization_id=org and section='company')<>'123' then raise exception 'Settings update was not atomic';end if;
end $$;
rollback;
