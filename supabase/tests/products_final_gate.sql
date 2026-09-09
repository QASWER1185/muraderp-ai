-- Products final-gate database regression.
-- Run only against an isolated/local database after all migrations are applied.
-- Every fixture is rolled back.
begin;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_brand bigint;
  v_other_brand bigint;
  v_product bigint;
  v_other_product bigint;
  v_warehouse bigint;
  v_other_warehouse bigint;
  v_customer bigint;
  v_rate_list bigint;
  v_rate_list_version bigint;
  v_estimate bigint;
begin
  insert into public.organizations(id, name, slug) values
    (v_org, 'Products Gate Org', 'products-gate-' || substr(v_org::text, 1, 8)),
    (v_other_org, 'Products Gate Other Org', 'products-gate-other-' || substr(v_other_org::text, 1, 8));

  -- Business identifiers are unique within a tenant, not globally.
  insert into public.brands(name, organization_id) values ('Gate Brand', v_org) returning id into v_brand;
  insert into public.brands(name, organization_id) values ('Gate Brand', v_other_org) returning id into v_other_brand;
  insert into public.products(brand_id, name, sku, category, unit, purchase_price, sale_price, organization_id)
  values (v_brand, 'Gate Product', 'GATE-SKU', 'TEST', 'piece', 10, 15, v_org)
  returning id into v_product;
  insert into public.products(brand_id, name, sku, category, unit, purchase_price, sale_price, organization_id)
  values (v_other_brand, 'Gate Product', 'GATE-SKU', 'TEST', 'piece', 10, 15, v_other_org)
  returning id into v_other_product;

  begin
    insert into public.products(name, sku, category, unit, purchase_price, sale_price, organization_id)
    values ('Duplicate Product', 'GATE-SKU', 'TEST', 'piece', 10, 15, v_org);
    raise exception 'same-organization duplicate SKU was accepted';
  exception when unique_violation then null;
  end;

  begin
    insert into public.products(brand_id, name, sku, category, unit, purchase_price, sale_price, organization_id)
    values (v_other_brand, 'Cross Brand Product', 'CROSS-BRAND', 'TEST', 'piece', 10, 15, v_org);
    raise exception 'cross-organization Product-to-Brand reference was accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.products(name, sku, category, unit, purchase_price, sale_price)
    values ('Unowned Product', 'UNOWNED-SKU', 'TEST', 'piece', 10, 15);
    raise exception 'new Product without organization ownership was accepted';
  exception when check_violation then null;
  end;

  begin
    update public.products set organization_id = v_other_org where id = v_product;
    raise exception 'assigned Product organization was mutable';
  exception when check_violation then null;
  end;

  -- Inventory balances cannot combine Products and warehouses from different tenants.
  insert into public.warehouses(name, location, organization_id)
  values ('Gate Warehouse', 'Test', v_org) returning id into v_warehouse;
  insert into public.warehouses(name, location, organization_id)
  values ('Gate Other Warehouse', 'Test', v_other_org) returning id into v_other_warehouse;
  insert into public.inventory(product_id, warehouse_id, quantity, organization_id)
  values (v_product, v_warehouse, 5, v_org);
  begin
    insert into public.inventory(product_id, warehouse_id, quantity, organization_id)
    values (v_product, v_other_warehouse, 1, v_org);
    raise exception 'cross-organization Product inventory was accepted';
  exception when foreign_key_violation then null;
  end;

  -- Dynamic pricing and estimates retain the authoritative Product identity.
  insert into public.rate_lists(name, code, price_type, scope_type, organization_id)
  values ('Gate Sale', 'GATE-SALE', 'SALE', 'GLOBAL', v_org) returning id into v_rate_list;
  insert into public.rate_list_versions(rate_list_id, version_number, status, effective_from)
  values (v_rate_list, 1, 'ACTIVE', now()) returning id into v_rate_list_version;
  insert into public.rate_list_items(rate_list_version_id, product_id, minimum_quantity, unit_price, unit)
  values (v_rate_list_version, v_product, 1, 15, 'piece');
  begin
    insert into public.rate_list_items(rate_list_version_id, product_id, minimum_quantity, unit_price, unit)
    values (v_rate_list_version, v_other_product, 1, 15, 'piece');
    raise exception 'cross-organization Product rate was accepted';
  exception when insufficient_privilege then null;
  end;

  insert into public.customers(name, phone, city, organization_id)
  values ('Gate Customer', '0000000000', 'Test', v_org) returning id into v_customer;
  insert into public.estimates(customer_id, estimate_number, issue_date, organization_id)
  values (v_customer, 'GATE-ESTIMATE', current_date, v_org) returning id into v_estimate;
  insert into public.estimate_items(
    estimate_id, line_number, product_id, quantity, unit, unit_price,
    pricing_source, rate_list_id, rate_list_version_id
  ) values (v_estimate, 1, v_product, 1, 'piece', 15, 'RESOLVED_RATE', v_rate_list, v_rate_list_version);
  begin
    insert into public.estimate_items(
      estimate_id, line_number, product_id, quantity, unit, unit_price, pricing_source
    ) values (v_estimate, 2, v_other_product, 1, 'piece', 15, 'MANUAL_OVERRIDE');
    raise exception 'cross-organization Product estimate line was accepted';
  exception when insufficient_privilege then null;
  end;

  -- The legacy unaudited inventory mutation path must be unavailable even to
  -- the service role; a future replacement needs its own authoritative engine.
  if has_function_privilege(
    'service_role',
    'public.record_inventory_adjustment(bigint,bigint,numeric,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'legacy inventory-adjustment RPC is executable by service_role';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.record_inventory_adjustment(bigint,bigint,numeric,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'legacy inventory-adjustment RPC is executable by authenticated';
  end if;
end
$$;

rollback;
