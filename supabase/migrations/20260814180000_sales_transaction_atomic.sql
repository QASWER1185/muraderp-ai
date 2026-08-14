-- MuradERP-AI Phase 6: authoritative atomic sales transaction.
-- Invoice posting is the single transaction boundary for stock, receivable,
-- revenue, COGS, pass-through rent, and estimate conversion.

alter table public.sales_transaction_idempotency_keys
  add column if not exists request_fingerprint text;

create or replace function public.record_sales_transaction(
  p_principal_id text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice_number text,
  p_customer_id bigint,
  p_source_estimate_id bigint,
  p_source_type text,
  p_issue_date date,
  p_currency_code text,
  p_subtotal numeric,
  p_discount_total numeric,
  p_grand_total numeric,
  p_pass_through_rent numeric,
  p_notes text,
  p_warehouse_id bigint,
  p_items jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id bigint;
  v_existing_invoice_id bigint;
  v_existing_fingerprint text;
  v_item jsonb;
  v_product_id bigint;
  v_quantity numeric;
  v_unit text;
  v_unit_price numeric;
  v_line_total numeric;
  v_unit_cost numeric;
  v_cogs_total numeric;
  v_sum numeric := 0;
  v_cogs numeric := 0;
  v_stock numeric;
  v_journal_id bigint;
  v_revenue numeric;
begin
  if btrim(coalesce(p_principal_id, '')) = '' then raise exception using errcode = '22023', message = 'principal_id is required'; end if;
  if btrim(coalesce(p_idempotency_key, '')) = '' then raise exception using errcode = '22023', message = 'idempotency_key is required'; end if;
  if btrim(coalesce(p_request_fingerprint, '')) = '' then raise exception using errcode = '22023', message = 'request_fingerprint is required'; end if;
  if btrim(coalesce(p_invoice_number, '')) = '' then raise exception using errcode = '22023', message = 'invoice_number is required'; end if;
  if p_source_type not in ('DIRECT', 'FROM_ESTIMATE') then raise exception using errcode = '22023', message = 'invalid source_type'; end if;
  if p_source_type = 'FROM_ESTIMATE' and p_source_estimate_id is null then raise exception using errcode = '22023', message = 'source_estimate_id is required'; end if;
  if p_source_type = 'DIRECT' and p_source_estimate_id is not null then raise exception using errcode = '22023', message = 'DIRECT invoice cannot have source_estimate_id'; end if;
  if p_customer_id <= 0 or p_warehouse_id <= 0 then raise exception using errcode = '22023', message = 'customer_id and warehouse_id must be positive'; end if;
  if p_subtotal < 0 or p_discount_total < 0 or p_grand_total < 0 or p_pass_through_rent < 0 then raise exception using errcode = '22023', message = 'invoice totals cannot be negative'; end if;
  if p_discount_total > p_subtotal then raise exception using errcode = '22023', message = 'discount_total cannot exceed subtotal'; end if;
  if p_grand_total <> p_subtotal - p_discount_total + p_pass_through_rent then raise exception using errcode = '22023', message = 'grand_total does not match invoice totals'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception using errcode = '22023', message = 'invoice must contain at least one line'; end if;

  insert into sales_transaction_idempotency_keys(principal_id, idempotency_key, request_fingerprint)
  values (p_principal_id, p_idempotency_key, p_request_fingerprint)
  on conflict (principal_id, idempotency_key) do nothing;

  select invoice_id, request_fingerprint into v_existing_invoice_id, v_existing_fingerprint
  from sales_transaction_idempotency_keys
  where principal_id = p_principal_id and idempotency_key = p_idempotency_key
  for update;

  if v_existing_fingerprint is not null and v_existing_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'P0001', message = 'idempotency key was already used for a different request';
  end if;
  if v_existing_invoice_id is not null then return v_existing_invoice_id; end if;

  if exists (select 1 from invoices where invoice_number = p_invoice_number) then
    raise exception using errcode = '23505', message = 'invoice number already exists';
  end if;
  if not exists (select 1 from customers where id = p_customer_id) then raise exception using errcode = '23503', message = 'customer not found'; end if;
  if not exists (select 1 from warehouses where id = p_warehouse_id) then raise exception using errcode = '23503', message = 'warehouse not found'; end if;

  if p_source_type = 'FROM_ESTIMATE' then
    perform 1 from estimates where id = p_source_estimate_id for update;
    if not found then raise exception using errcode = '23503', message = 'source estimate not found'; end if;
    if (select status from estimates where id = p_source_estimate_id) <> 'READY' then
      raise exception using errcode = '22023', message = 'source estimate must be READY';
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::bigint;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := btrim(v_item->>'unit');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_total := (v_item->>'line_total')::numeric;
    if v_product_id <= 0 or v_quantity <= 0 or v_unit_price < 0 then raise exception using errcode = '22023', message = 'invalid invoice line'; end if;
    if v_unit = '' then raise exception using errcode = '22023', message = 'invoice line unit is required'; end if;
    if v_line_total <> v_quantity * v_unit_price then raise exception using errcode = '22023', message = 'invoice line total mismatch'; end if;
    select quantity into v_stock from inventory where product_id = v_product_id and warehouse_id = p_warehouse_id for update;
    if not found or v_stock < v_quantity then raise exception using errcode = 'P0004', message = 'insufficient stock'; end if;
    select purchase_price into v_unit_cost from products where id = v_product_id;
    if not found then raise exception using errcode = '23503', message = 'product not found'; end if;
    v_cogs_total := v_quantity * v_unit_cost;
    v_sum := v_sum + v_line_total;
    v_cogs := v_cogs + v_cogs_total;
  end loop;

  if v_sum <> p_subtotal then raise exception using errcode = '22023', message = 'subtotal does not match invoice lines'; end if;

  insert into invoices(invoice_number, customer_id, source_estimate_id, source_type, issue_date, currency_code, status, subtotal, discount_total, grand_total, pass_through_rent, notes)
  values (p_invoice_number, p_customer_id, p_source_estimate_id, p_source_type, p_issue_date, p_currency_code, 'POSTED', p_subtotal, p_discount_total, p_grand_total, p_pass_through_rent, p_notes)
  returning id into v_invoice_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::bigint;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := btrim(v_item->>'unit');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_total := (v_item->>'line_total')::numeric;
    select purchase_price into v_unit_cost from products where id = v_product_id;
    v_cogs_total := v_quantity * v_unit_cost;
    insert into invoice_items(invoice_id, line_number, product_id, quantity, unit, unit_price, line_total, unit_cost, cogs_total, pricing_source)
    values (v_invoice_id, (v_item->>'line_number')::integer, v_product_id, v_quantity, v_unit, v_unit_price, v_line_total, v_unit_cost, v_cogs_total, coalesce(v_item->>'pricing_source', 'MANUAL_OVERRIDE'));
    update inventory set quantity = quantity - v_quantity, updated_at = now() where product_id = v_product_id and warehouse_id = p_warehouse_id;
    insert into stock_movements(product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, unit_cost, notes)
    values (v_product_id, p_warehouse_id, 'SALE', -v_quantity, 'INVOICE', v_invoice_id, v_unit_cost, p_invoice_number);
  end loop;

  insert into customer_ledger_entries(customer_id, entry_type, reference_type, reference_id, debit, credit, currency_code, entry_date, description)
  values (p_customer_id, 'INVOICE', 'INVOICE', v_invoice_id, p_grand_total, 0, p_currency_code, p_issue_date, p_invoice_number);

  insert into accounting_journal_entries(entry_date, source_type, source_id, description)
  values (p_issue_date, 'INVOICE', v_invoice_id, p_invoice_number)
  returning id into v_journal_id;

  v_revenue := p_grand_total - p_pass_through_rent;
  insert into accounting_journal_lines(journal_entry_id, account_code, debit, credit, description)
  values (v_journal_id, '1100-AR', p_grand_total, 0, 'Customer receivable');
  if v_revenue > 0 then insert into accounting_journal_lines(journal_entry_id, account_code, debit, credit, description) values (v_journal_id, '4100-SALES', 0, v_revenue, 'Sales revenue'); end if;
  if p_pass_through_rent > 0 then insert into accounting_journal_lines(journal_entry_id, account_code, debit, credit, description) values (v_journal_id, '2100-RENT-PAYABLE', 0, p_pass_through_rent, 'Pass-through rent payable'); end if;
  if v_cogs > 0 then
    insert into accounting_journal_lines(journal_entry_id, account_code, debit, credit, description) values (v_journal_id, '5100-COGS', v_cogs, 0, 'Cost of goods sold');
    insert into accounting_journal_lines(journal_entry_id, account_code, debit, credit, description) values (v_journal_id, '1200-INVENTORY', 0, v_cogs, 'Inventory reduction');
  end if;

  if p_source_type = 'FROM_ESTIMATE' then update estimates set status = 'CONVERTED', updated_at = now() where id = p_source_estimate_id; end if;
  update sales_transaction_idempotency_keys set invoice_id = v_invoice_id, request_fingerprint = p_request_fingerprint where principal_id = p_principal_id and idempotency_key = p_idempotency_key;
  return v_invoice_id;
end;
$$;

grant execute on function public.record_sales_transaction(text, text, text, text, bigint, bigint, text, date, text, numeric, numeric, numeric, numeric, text, bigint, jsonb) to service_role;
