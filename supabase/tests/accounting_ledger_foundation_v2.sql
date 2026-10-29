-- Authoritative accounting smoke test; all synthetic tenant data rolls back.
begin;
do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_actor uuid := gen_random_uuid();
  v_branch uuid := gen_random_uuid();
  v_customer bigint;
  v_product bigint;
  v_warehouse bigint;
  v_invoice jsonb;
  v_lines jsonb;
  v_result jsonb;
  v_replay jsonb;
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
begin
  insert into auth.users(id) values (v_actor);
  insert into public.organizations(id, name, slug) values
    (v_org, 'Accounting Regression', 'accounting-test-' || v_org::text),
    (v_other_org, 'Other Accounting Tenant', 'accounting-other-' || v_other_org::text);
  insert into public.organization_memberships(organization_id, user_id, role, status)
  values (v_org, v_actor, 'sales', 'active');
  insert into public.branches(id, organization_id, code, name) values (v_branch, v_org, 'MAIN', 'Main');
  insert into public.branch_access_grants(organization_id, branch_id, user_id) values (v_org, v_branch, v_actor);
  insert into public.customers(name, phone, city, organization_id)
  values ('Accounting Customer', '000', 'Test', v_org) returning id into v_customer;
  insert into public.products(name, sku, category, unit, purchase_price, sale_price, organization_id)
  values ('Accounting Product', 'ACCOUNTING-TEST', 'TEST', 'piece', 10, 100, v_org)
  returning id into v_product;
  insert into public.warehouses(name, location, organization_id)
  values ('Accounting Warehouse', 'Test', v_org) returning id into v_warehouse;
  insert into public.inventory(product_id, warehouse_id, quantity, organization_id)
  values (v_product, v_warehouse, 2, v_org);

  v_invoice := jsonb_build_object(
    'invoice_number', 'accounting-' || v_org::text, 'customer_id', v_customer,
    'source_type', 'DIRECT', 'issue_date', current_date, 'currency_code', 'PKR',
    'subtotal', 100, 'discount_total', 0, 'grand_total', 100, 'pass_through_rent', 0);
  v_lines := jsonb_build_array(jsonb_build_object(
    'line_number', 1, 'product_id', v_product, 'quantity', 1, 'unit', 'piece',
    'unit_price', 100, 'line_total', 100, 'unit_cost', 10, 'cogs_total', 10,
    'pricing_source', 'MANUAL_OVERRIDE'));

  -- This is the same authoritative posting RPC used by the accounting service.
  -- Run with service_role privileges so the regression cannot bypass its grants.
  set local role service_role;
  v_result := public.post_invoice_atomic(
    v_org, v_branch, v_actor, 'accounting-regression', 'sales.invoice.post',
    'accounting-smoke', repeat('a', 64), v_invoice, v_lines, v_warehouse);
  v_entry := (v_result->>'journal_entry_id')::uuid;
  if v_entry is null or not exists (
    select 1 from public.journal_entries
    where id = v_entry and organization_id = v_org and status = 'POSTED'
  ) then raise exception 'authoritative tenant-scoped journal missing'; end if;
  select sum(debit), sum(credit) into v_debit, v_credit
  from public.journal_lines where journal_entry_id = v_entry;
  if v_debit is distinct from 110::numeric or v_credit is distinct from 110::numeric then
    raise exception 'journal did not balance: debit %, credit %', v_debit, v_credit;
  end if;
  if not exists (
    select 1 from public.trial_balance
    where organization_id = v_org and code = '1100' and total_debit = 100
  ) then raise exception 'tenant trial balance projection missing posted debit'; end if;

  v_replay := public.post_invoice_atomic(
    v_org, v_branch, v_actor, 'accounting-regression', 'sales.invoice.post',
    'accounting-smoke', repeat('a', 64), v_invoice, v_lines, v_warehouse);
  if (v_replay->>'journal_entry_id')::uuid is distinct from v_entry
     or (v_replay->>'replayed')::boolean is distinct from true
     or (select quantity from public.inventory where product_id = v_product and warehouse_id = v_warehouse) is distinct from 1::numeric then
    raise exception 'authoritative replay duplicated accounting or inventory';
  end if;

  begin
    perform public.post_invoice_atomic(
      v_other_org, null, v_actor, 'accounting-regression', 'sales.invoice.post',
      'other-tenant', repeat('b', 64), v_invoice, v_lines, v_warehouse);
    raise exception 'cross-tenant posting was accepted';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('service_role',
    'public.post_journal_entry(date,text,text,uuid,text,jsonb)', 'EXECUTE') then
    raise exception 'legacy journal writer is executable by service_role';
  end if;
  reset role;
end $$;
rollback;
