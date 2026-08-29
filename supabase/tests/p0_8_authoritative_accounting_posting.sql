-- P0-8 authoritative accounting posting database regression.
-- Run only on an isolated/local database after the P0-8 migration is applied.
-- All fixtures and successful postings are rolled back at the end.
begin;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_other_org uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_customer bigint;
  v_product bigint;
  v_warehouse bigint;
  v_result jsonb;
  v_replay jsonb;
  v_invoice_id bigint;
  v_journal_id uuid;
  v_inventory_before numeric;
  v_inventory_after numeric;
  v_count_before bigint;
  v_debit numeric;
  v_credit numeric;
  v_ar uuid;
  v_sales uuid;
  v_test_journal uuid;
  v_invoice jsonb;
  v_lines jsonb;
  v_rent_invoice jsonb;
  v_insufficient_invoice jsonb;
  v_failure_invoice jsonb;
begin
  insert into auth.users(id) values (v_user);
  insert into public.organizations(id, name, slug)
  values
    (v_org, 'P0-8 Regression Org', 'p0-8-regression-' || substr(v_org::text, 1, 8)),
    (v_other_org, 'P0-8 Other Org', 'p0-8-other-' || substr(v_other_org::text, 1, 8));
  insert into public.organization_memberships(organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active');

  insert into public.customers(name, phone, city, organization_id)
  values ('P0-8 Customer', '0000000000', 'Test', v_org)
  returning id into v_customer;

  insert into public.products(name, sku, category, unit, purchase_price, sale_price, organization_id)
  values ('P0-8 Product', 'P0-8-' || substr(gen_random_uuid()::text, 1, 8), 'TEST', 'piece', 60, 100, v_org)
  returning id into v_product;

  insert into public.warehouses(name, location, organization_id)
  values ('P0-8 Warehouse', 'Test', v_org)
  returning id into v_warehouse;

  insert into public.inventory(product_id, warehouse_id, quantity, organization_id)
  values (v_product, v_warehouse, 10, v_org);

  select id into v_ar from public.accounts where code='1100' and is_active;
  select id into v_sales from public.accounts where code='4000' and is_active;
  if v_ar is null or v_sales is null then
    raise exception 'P0-8 regression requires AR and Sales Revenue accounts';
  end if;

  -- Database-enforced balanced journal acceptance.
  insert into public.journal_entries(
    organization_id, actor_user_id, entry_date, description, source_type,
    source_record_id, posting_kind, principal_scope, operation_scope,
    idempotency_key, request_fingerprint, status
  ) values (
    v_org, v_user, current_date, 'P0-8 balanced regression', 'TEST',
    'balanced-' || gen_random_uuid()::text, 'PRIMARY', 'p0-8-sql-test',
    'accounting.test', 'balanced-' || gen_random_uuid()::text,
    'balanced-fingerprint', 'DRAFT'
  ) returning id into v_test_journal;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo) values
    (v_test_journal, v_ar, 100, 0, 'Balanced debit'),
    (v_test_journal, v_sales, 0, 100, 'Balanced credit');
  update public.journal_entries set status='POSTED' where id=v_test_journal;
  set constraints all immediate;
  set constraints all deferred;

  -- Unbalanced journal rejection.
  insert into public.journal_entries(
    organization_id, actor_user_id, entry_date, description, source_type,
    source_record_id, posting_kind, principal_scope, operation_scope,
    idempotency_key, request_fingerprint, status
  ) values (
    v_org, v_user, current_date, 'P0-8 unbalanced regression', 'TEST',
    'unbalanced-' || gen_random_uuid()::text, 'PRIMARY', 'p0-8-sql-test',
    'accounting.test', 'unbalanced-' || gen_random_uuid()::text,
    'unbalanced-fingerprint', 'DRAFT'
  ) returning id into v_test_journal;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo) values
    (v_test_journal, v_ar, 100, 0, 'Unbalanced debit'),
    (v_test_journal, v_sales, 0, 99, 'Unbalanced credit');
  begin
    update public.journal_entries set status='POSTED' where id=v_test_journal;
    set constraints all immediate;
    raise exception 'unbalanced authoritative journal was accepted';
  exception
    when check_violation then
      if position('total debits must equal total credits' in sqlerrm) = 0 then raise; end if;
  end;
  set constraints all deferred;

  -- Zero-debit journal rejection: two valid credit-only lines make total debit zero.
  insert into public.journal_entries(
    organization_id, actor_user_id, entry_date, description, source_type,
    source_record_id, posting_kind, principal_scope, operation_scope,
    idempotency_key, request_fingerprint, status
  ) values (
    v_org, v_user, current_date, 'P0-8 zero-debit regression', 'TEST',
    'zero-' || gen_random_uuid()::text, 'PRIMARY', 'p0-8-sql-test',
    'accounting.test', 'zero-' || gen_random_uuid()::text,
    'zero-fingerprint', 'DRAFT'
  ) returning id into v_test_journal;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo) values
    (v_test_journal, v_sales, 0, 50, 'Zero debit credit one'),
    (v_test_journal, v_sales, 0, 50, 'Zero debit credit two');
  begin
    update public.journal_entries set status='POSTED' where id=v_test_journal;
    set constraints all immediate;
    raise exception 'zero-debit authoritative journal was accepted';
  exception
    when check_violation then
      if position('total debit must be greater than zero' in sqlerrm) = 0 then raise; end if;
  end;
  set constraints all deferred;

  v_lines := jsonb_build_array(jsonb_build_object(
    'line_number', 1,
    'product_id', v_product,
    'quantity', 1,
    'unit', 'piece',
    'unit_price', 100,
    'line_total', 100,
    'unit_cost', 60,
    'cogs_total', 60,
    'pricing_source', 'MANUAL_OVERRIDE'
  ));

  -- rent = 0 success and cross-table consistency.
  v_invoice := jsonb_build_object(
    'invoice_number', 'P0-8-ZERO-' || substr(gen_random_uuid()::text, 1, 8),
    'customer_id', v_customer,
    'source_estimate_id', null,
    'source_type', 'DIRECT',
    'issue_date', current_date,
    'currency_code', 'PKR',
    'subtotal', 100,
    'discount_total', 0,
    'grand_total', 100,
    'pass_through_rent', 0
  );
  select quantity into v_inventory_before from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  v_result := public.post_invoice_atomic(
    v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
    'rent-zero-' || gen_random_uuid()::text, 'fp-rent-zero', v_invoice, v_lines, v_warehouse
  );
  v_invoice_id := (v_result->>'invoice_id')::bigint;
  v_journal_id := (v_result->>'journal_entry_id')::uuid;
  if v_invoice_id is null or v_journal_id is null or (v_result->>'replayed')::boolean then
    raise exception 'rent=0 posting did not return a new invoice and journal';
  end if;
  select quantity into v_inventory_after from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  if v_inventory_after <> v_inventory_before - 1 then raise exception 'rent=0 inventory decrement mismatch'; end if;
  if not exists (
    select 1 from public.customer_ledger_entries
    where organization_id=v_org and reference_type='INVOICE' and reference_id=v_invoice_id and debit=100 and credit=0
  ) then raise exception 'rent=0 receivable projection mismatch'; end if;
  select sum(debit), sum(credit) into v_debit, v_credit from public.journal_lines where journal_entry_id=v_journal_id;
  if v_debit <> 160 or v_credit <> 160 then raise exception 'rent=0 authoritative journal mismatch: debit %, credit %', v_debit, v_credit; end if;

  -- rent > 0: grand_total remains product total; AR includes rent exactly once.
  v_rent_invoice := v_invoice || jsonb_build_object(
    'invoice_number', 'P0-8-RENT-' || substr(gen_random_uuid()::text, 1, 8),
    'pass_through_rent', 20
  );
  v_result := public.post_invoice_atomic(
    v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
    'rent-positive-key', 'fp-rent-positive', v_rent_invoice, v_lines, v_warehouse
  );
  v_invoice_id := (v_result->>'invoice_id')::bigint;
  v_journal_id := (v_result->>'journal_entry_id')::uuid;
  if (v_result->>'revenue')::numeric <> 100 or (v_result->>'rent')::numeric <> 20 then
    raise exception 'rent>0 revenue/rent result mismatch';
  end if;
  if not exists (
    select 1 from public.customer_ledger_entries
    where organization_id=v_org and reference_type='INVOICE' and reference_id=v_invoice_id and debit=120 and credit=0
  ) then raise exception 'rent>0 receivable must equal grand_total plus rent'; end if;
  if not exists (
    select 1 from public.journal_lines jl join public.accounts a on a.id=jl.account_id
    where jl.journal_entry_id=v_journal_id and a.code='1100' and jl.debit=120 and jl.credit=0
  ) then raise exception 'rent>0 AR journal line mismatch'; end if;
  if not exists (
    select 1 from public.journal_lines jl join public.accounts a on a.id=jl.account_id
    where jl.journal_entry_id=v_journal_id and a.code='2100' and jl.debit=0 and jl.credit=20
  ) then raise exception 'rent>0 Rent Payable journal line mismatch'; end if;
  select sum(debit), sum(credit) into v_debit, v_credit from public.journal_lines where journal_entry_id=v_journal_id;
  if v_debit <> 180 or v_credit <> 180 then raise exception 'rent>0 authoritative journal mismatch: debit %, credit %', v_debit, v_credit; end if;

  -- Idempotent replay returns the original invoice/journal and makes no second stock movement.
  select quantity into v_inventory_before from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  v_replay := public.post_invoice_atomic(
    v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
    'rent-positive-key', 'fp-rent-positive', v_rent_invoice, v_lines, v_warehouse
  );
  if (v_replay->>'invoice_id')::bigint <> v_invoice_id
     or (v_replay->>'journal_entry_id')::uuid <> v_journal_id
     or not (v_replay->>'replayed')::boolean then
    raise exception 'idempotent replay did not return the original authoritative posting';
  end if;
  select quantity into v_inventory_after from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  if v_inventory_after <> v_inventory_before then raise exception 'idempotent replay changed inventory'; end if;

  -- Same scoped key with a different fingerprint is rejected.
  begin
    perform public.post_invoice_atomic(
      v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
      'rent-positive-key', 'different-fingerprint', v_rent_invoice, v_lines, v_warehouse
    );
    raise exception 'different-fingerprint duplicate request was accepted';
  exception
    when raise_exception then
      if sqlstate <> 'P0001' or position('different sales request' in sqlerrm)=0 then raise; end if;
  end;

  -- Organization isolation fails before source/master-data mutation.
  select count(*) into v_count_before from public.invoices;
  begin
    perform public.post_invoice_atomic(
      v_other_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
      'other-org-key', 'fp-other-org',
      v_invoice || jsonb_build_object('invoice_number', 'P0-8-OTHER-' || substr(gen_random_uuid()::text, 1, 8)),
      v_lines, v_warehouse
    );
    raise exception 'cross-organization posting was accepted';
  exception
    when insufficient_privilege then null;
  end;
  if (select count(*) from public.invoices) <> v_count_before then raise exception 'cross-organization rejection left an invoice'; end if;

  -- Insufficient stock rolls the entire statement back.
  v_insufficient_invoice := v_invoice || jsonb_build_object(
    'invoice_number', 'P0-8-STOCK-' || substr(gen_random_uuid()::text, 1, 8),
    'subtotal', 99900,
    'grand_total', 99900
  );
  select quantity into v_inventory_before from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  select count(*) into v_count_before from public.invoices;
  begin
    perform public.post_invoice_atomic(
      v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
      'insufficient-key', 'fp-insufficient', v_insufficient_invoice,
      jsonb_build_array(jsonb_build_object(
        'line_number', 1, 'product_id', v_product, 'quantity', 999,
        'unit', 'piece', 'unit_price', 100, 'line_total', 99900,
        'unit_cost', 60, 'cogs_total', 59940, 'pricing_source', 'MANUAL_OVERRIDE'
      )), v_warehouse
    );
    raise exception 'insufficient-stock posting was accepted';
  exception
    when sqlstate 'P0004' then
      if position('insufficient stock' in sqlerrm)=0 then raise; end if;
  end;
  select quantity into v_inventory_after from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  if v_inventory_after <> v_inventory_before or (select count(*) from public.invoices) <> v_count_before then
    raise exception 'insufficient-stock failure did not roll back atomically';
  end if;

  -- Inject a late journal-line failure after invoice/inventory/AR work to prove
  -- PostgreSQL rolls the entire authoritative posting statement back.
  create or replace function private.p0_8_regression_fail_journal_line()
  returns trigger language plpgsql security invoker set search_path='' as $test$
  begin
    if new.memo = 'Product sales revenue' then
      raise exception using errcode='23514', message='P0-8 injected accounting failure';
    end if;
    return new;
  end;
  $test$;
  create trigger zz_p0_8_regression_fail_journal_line
  before insert on public.journal_lines
  for each row execute function private.p0_8_regression_fail_journal_line();

  v_failure_invoice := v_invoice || jsonb_build_object('invoice_number', 'P0-8-FAIL-' || substr(gen_random_uuid()::text, 1, 8));
  select quantity into v_inventory_before from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  select count(*) into v_count_before from public.invoices;
  begin
    perform public.post_invoice_atomic(
      v_org, null, v_user, 'p0-8-sql-test', 'sales.invoice.post',
      'accounting-failure-key', 'fp-accounting-failure', v_failure_invoice, v_lines, v_warehouse
    );
    raise exception 'injected accounting failure was not raised';
  exception
    when check_violation then
      if position('P0-8 injected accounting failure' in sqlerrm)=0 then raise; end if;
  end;
  select quantity into v_inventory_after from public.inventory where product_id=v_product and warehouse_id=v_warehouse;
  if v_inventory_after <> v_inventory_before or (select count(*) from public.invoices) <> v_count_before then
    raise exception 'accounting failure did not roll back invoice/inventory atomically';
  end if;
  if exists (
    select 1 from public.customer_ledger_entries cle
    where cle.organization_id=v_org and cle.description=(v_failure_invoice->>'invoice_number')
  ) then raise exception 'accounting failure left a receivable projection'; end if;

  drop trigger zz_p0_8_regression_fail_journal_line on public.journal_lines;
  drop function private.p0_8_regression_fail_journal_line();
end
$$;

rollback;
