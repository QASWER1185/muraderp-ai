-- LOCAL DEVELOPMENT ONLY, loaded by `supabase db reset`. Never apply this as
-- a production migration. All data belongs to a separate synthetic tenant.
begin;
do $$
declare
  demo_org constant uuid := 'd3000000-0000-4000-8000-000000000001';
  demo_branch constant uuid := 'd3000000-0000-4000-8000-000000000002';
  demo_actor constant uuid := 'd3000000-0000-4000-8000-000000000003';
  customer_id bigint;
  cement_id bigint;
  pipe_id bigint;
  warehouse_id bigint;
begin
  if exists (select 1 from public.organizations where id=demo_org and slug <> 'copilot-local-demo') then
    raise exception 'Demo organization ID is already in use';
  end if;
  insert into public.organizations(id,name,slug)
    values(demo_org,'Copilot Local Demo (synthetic)','copilot-local-demo') on conflict (id) do nothing;
  insert into public.branches(id,organization_id,code,name)
    values(demo_branch,demo_org,'DEMO','Copilot Demo Branch') on conflict (id) do nothing;
  -- Posting actor only: no login credential, password or production access.
  insert into auth.users(id) values(demo_actor) on conflict (id) do nothing;
  insert into public.organization_memberships(organization_id,user_id,role,status)
    values(demo_org,demo_actor,'owner','active') on conflict (organization_id,user_id) do nothing;
  insert into public.branch_access_grants(organization_id,branch_id,user_id)
    values(demo_org,demo_branch,demo_actor) on conflict do nothing;

  select id into customer_id from public.customers where organization_id=demo_org and name='Hamdan Sahib' order by id limit 1;
  if customer_id is null then
    insert into public.customers(organization_id,name,phone,city)
      values(demo_org,'Hamdan Sahib','0000000000','Demo City') returning id into customer_id;
  end if;
  select id into cement_id from public.products where organization_id=demo_org and sku='COPILOT-DEMO-CEMENT';
  if cement_id is null then
    insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price)
      values(demo_org,'Bestway Cement','COPILOT-DEMO-CEMENT','Cement','BAG',1000,1200) returning id into cement_id;
  end if;
  select id into pipe_id from public.products where organization_id=demo_org and sku='COPILOT-DEMO-PIPE';
  if pipe_id is null then
    insert into public.products(organization_id,name,sku,category,unit,purchase_price,sale_price)
      values(demo_org,'Popular UPVC Pipe 4"','COPILOT-DEMO-PIPE','Pipe','PCS',900,1500) returning id into pipe_id;
  end if;
  select id into warehouse_id from public.warehouses where organization_id=demo_org and name='Copilot Demo Warehouse' order by id limit 1;
  if warehouse_id is null then
    insert into public.warehouses(organization_id,name,location)
      values(demo_org,'Copilot Demo Warehouse','Local development') returning id into warehouse_id;
  end if;
  insert into public.inventory(organization_id,product_id,warehouse_id,quantity)
    values(demo_org,cement_id,warehouse_id,0),(demo_org,pipe_id,warehouse_id,20) on conflict do nothing;
  -- Create the PKR 1,500 sample receivable through authoritative posting.
  -- Re-running the seed replays this key; it never duplicates stock or ledger.
  perform public.post_invoice_atomic(demo_org,demo_branch,demo_actor,'copilot-local-seed','sales.invoice.post',
    'copilot-demo-invoice-v1','copilot-demo-invoice-v1',
    jsonb_build_object('invoice_number','COPILOT-DEMO-001','customer_id',customer_id,'source_type','DIRECT',
      'issue_date','2026-10-01','currency_code','PKR','subtotal',1500,'discount_total',0,'grand_total',1500,'pass_through_rent',0),
    jsonb_build_array(jsonb_build_object('line_number',1,'product_id',pipe_id,'quantity',1,'unit','PCS',
      'unit_price',1500,'line_total',1500,'unit_cost',900,'cogs_total',900,'pricing_source','MANUAL_OVERRIDE')),warehouse_id);
end;
$$;
commit;
