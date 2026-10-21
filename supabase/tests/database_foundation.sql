-- Transactional smoke test for the MuradERP database foundation.
-- The test creates technical-only fixture rows and rolls all of them back.

begin;

do $$
declare
  v_suffix text := txid_current()::text;
  v_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_brand_id bigint;
  v_vendor_id bigint;
  v_product_id bigint;
  v_warehouse_id bigint;
  v_purchase_id bigint;
  v_inventory_before numeric;
  v_inventory_after numeric;
begin
  insert into auth.users(id) values (v_actor);
  insert into public.organizations(id, name, slug)
  values (v_org, 'Database Regression', 'db-test-' || v_org::text);
  insert into public.organization_memberships(organization_id, user_id, role, status)
  values (v_org, v_actor, 'owner', 'active');
  insert into public.branches(id, organization_id, code, name, status)
  values (v_branch, v_org, 'TEST', 'Database Test Branch', 'active');
  insert into public.branch_access_grants(organization_id, branch_id, user_id, status)
  values (v_org, v_branch, v_actor, 'active');

  insert into public.brands (name, organization_id)
  values ('db_test_brand_' || v_suffix, v_org)
  returning id into v_brand_id;

  insert into public.vendors (name, phone, city, organization_id)
  values ('db_test_vendor_' || v_suffix, 'n/a', 'n/a', v_org)
  returning id into v_vendor_id;

  insert into public.products (
    brand_id,
    name,
    sku,
    category,
    unit,
    purchase_price,
    sale_price,
    organization_id
  )
  values (
    v_brand_id,
    'db_test_product_' || v_suffix,
    'db-test-sku-' || v_suffix,
    'db_test',
    'unit',
    10,
    12,
    v_org
  )
  returning id into v_product_id;

  insert into public.warehouses (name, location, organization_id)
  values ('db_test_warehouse_' || v_suffix, 'db_test', v_org)
  returning id into v_warehouse_id;

  select coalesce(quantity, 0)
  into v_inventory_before
  from public.inventory
  where product_id = v_product_id
    and warehouse_id = v_warehouse_id;

  v_inventory_before := coalesce(v_inventory_before, 0);

  -- Use the tenant/branch/actor-authorized purchase posting boundary.
  v_purchase_id := (public.record_purchase(
    p_organization_id => v_org,
    p_branch_id => v_branch,
    p_actor_user_id => v_actor,
    p_service_principal => 'database-regression',
    p_operation_scope => 'purchase.create',
    p_idempotency_key => 'db-test-purchase-' || v_suffix,
    p_request_fingerprint => repeat('a', 64),
    p_vendor_id => v_vendor_id,
    p_warehouse_id => v_warehouse_id,
    p_items => jsonb_build_array(
      jsonb_build_object(
        'product_id', v_product_id,
        'quantity', 3,
        'unit_cost', 10
      )
    ),
    p_invoice_number => 'db-test-invoice-' || v_suffix,
    p_discount => 2,
    p_tax => 1,
    p_notes => 'transactional database smoke test'
  )->'response_body'->'data'->'purchase'->>'id')::bigint;

  if v_purchase_id is null then
    raise exception 'authoritative purchase response is missing purchase id';
  end if;

  if not exists (
    select 1
    from public.purchases
    where id = v_purchase_id
      and organization_id = v_org
      and branch_id = v_branch
      and subtotal = 30
      and total = 29
  ) then
    raise exception 'Purchase totals were not recorded correctly';
  end if;

  if not exists (
    select 1
    from public.purchase_items
    where purchase_id = v_purchase_id
      and organization_id = v_org
      and product_id = v_product_id
      and quantity = 3
      and unit_cost = 10
      and total_cost = 30
  ) then
    raise exception 'Purchase item was not recorded correctly';
  end if;

  if not exists (
    select 1
    from public.stock_movements
    where reference_type = 'PURCHASE'
      and organization_id = v_org
      and reference_id = v_purchase_id
      and product_id = v_product_id
      and warehouse_id = v_warehouse_id
      and quantity = 3
  ) then
    raise exception 'Stock movement was not recorded correctly';
  end if;

  select quantity
  into v_inventory_after
  from public.inventory
  where product_id = v_product_id
    and warehouse_id = v_warehouse_id;

  if v_inventory_after is distinct from v_inventory_before + 3 then
    raise exception 'Inventory was not updated exactly once';
  end if;
end;
$$;

rollback;
