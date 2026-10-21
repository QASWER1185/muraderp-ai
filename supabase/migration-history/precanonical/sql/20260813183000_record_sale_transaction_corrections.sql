-- Corrective migration for the atomic Invoice transaction.
-- Keeps rent outside revenue, validates inventory before mutation, and preserves
-- salesperson attribution and idempotency inside the same transaction.

alter table public.invoices
  add column if not exists salesperson_id bigint references public.salespeople (id);

create index if not exists invoices_salesperson_id_idx
  on public.invoices (salesperson_id);

drop function if exists public.record_sale_transaction(text,bigint,bigint,date,text,text,bigint,numeric,numeric,numeric,numeric,jsonb,text,text);

create or replace function public.record_sale_transaction(
  p_invoice_number text,
  p_customer_id bigint,
  p_warehouse_id bigint,
  p_issue_date date,
  p_currency_code text,
  p_source_type text,
  p_source_estimate_id bigint,
  p_salesperson_id bigint,
  p_subtotal numeric,
  p_discount_total numeric,
  p_grand_total numeric,
  p_pass_through_rent numeric,
  p_items jsonb,
  p_idempotency_key text,
  p_principal_id text
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invoice_id bigint;
  v_journal_id bigint;
  v_subtotal numeric := 0;
  v_cogs numeric := 0;
  v_payable numeric := 0;
  v_product_id bigint;
  v_required numeric;
  v_available numeric;
begin
  if nullif(btrim(p_idempotency_key), '') is null or nullif(btrim(p_principal_id), '') is null then
    raise exception 'Idempotency context is required' using errcode = '22023';
  end if;
  if nullif(btrim(p_invoice_number), '') is null then
    raise exception 'Invoice number is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Invoice must contain at least one item' using errcode = '22023';
  end if;
  if p_subtotal < 0 or p_discount_total < 0 or p_grand_total < 0 or p_pass_through_rent < 0 then
    raise exception 'Invoice totals cannot be negative' using errcode = '22023';
  end if;
  if p_discount_total > p_subtotal then
    raise exception 'Discount cannot exceed subtotal' using errcode = '22023';
  end if;
  if p_grand_total <> p_subtotal - p_discount_total then
    raise exception 'Grand total does not match subtotal less discount' using errcode = '22023';
  end if;

  select invoice_id into v_invoice_id
  from public.sales_transaction_idempotency_keys
  where principal_id = p_principal_id and idempotency_key = p_idempotency_key
  for update;

  if v_invoice_id is not null then
    return v_invoice_id;
  end if;

  perform 1 from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer does not exist' using errcode = '23503'; end if;

  perform 1 from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'Warehouse does not exist' using errcode = '23503'; end if;

  if p_salesperson_id is not null then
    perform 1 from public.salespeople where id = p_salesperson_id and is_active = true;
    if not found then raise exception 'Salesperson does not exist or is inactive' using errcode = '23503'; end if;
  end if;

  select
    coalesce(sum(x.quantity * x.unit_price), 0),
    coalesce(sum(coalesce(x.cogs_total, 0)), 0)
  into v_subtotal, v_cogs
  from jsonb_to_recordset(p_items) as x(
    product_id bigint,
    quantity numeric,
    unit text,
    unit_price numeric,
    line_total numeric,
    unit_cost numeric,
    cogs_total numeric
  );

  if v_subtotal <> p_subtotal then
    raise exception 'Invoice subtotal does not match lines' using errcode = '22023';
  end if;

  -- Validate every product's required quantity before inserting or mutating anything.
  for v_product_id, v_required in
    select x.product_id, sum(x.quantity)
    from jsonb_to_recordset(p_items) as x(
      product_id bigint,
      quantity numeric,
      unit text,
      unit_price numeric,
      line_total numeric,
      unit_cost numeric,
      cogs_total numeric
    )
    group by x.product_id
  loop
    if v_product_id is null or v_required <= 0 then
      raise exception 'Invalid invoice inventory line' using errcode = '22023';
    end if;

    select quantity into v_available
    from public.inventory
    where product_id = v_product_id and warehouse_id = p_warehouse_id
    for update;

    if v_available is null then
      raise exception 'Inventory record does not exist for product % in warehouse %', v_product_id, p_warehouse_id using errcode = '22023';
    end if;
    if v_available < v_required then
      raise exception 'Insufficient inventory for product %: required %, available %', v_product_id, v_required, v_available using errcode = '22023';
    end if;
  end loop;

  v_payable := p_grand_total + p_pass_through_rent;

  insert into public.invoices (
    invoice_number, customer_id, salesperson_id, source_estimate_id, source_type,
    issue_date, currency_code, status, subtotal, discount_total, grand_total,
    pass_through_rent
  ) values (
    btrim(p_invoice_number), p_customer_id, p_salesperson_id, p_source_estimate_id,
    p_source_type, p_issue_date, p_currency_code, 'POSTED', p_subtotal,
    p_discount_total, p_grand_total, p_pass_through_rent
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, line_number, product_id, quantity, unit, unit_price,
    line_total, unit_cost, cogs_total, pricing_source
  )
  select
    v_invoice_id,
    row_number() over (order by x.product_id, x.quantity, x.unit_price),
    x.product_id, x.quantity, x.unit, x.unit_price, x.line_total,
    x.unit_cost, x.cogs_total, 'RESOLVED'
  from jsonb_to_recordset(p_items) as x(
    product_id bigint,
    quantity numeric,
    unit text,
    unit_price numeric,
    line_total numeric,
    unit_cost numeric,
    cogs_total numeric
  );

  insert into public.stock_movements (
    product_id, warehouse_id, movement_type, quantity, reference_type,
    reference_id, unit_cost, notes
  )
  select x.product_id, p_warehouse_id, 'SALE', sum(x.quantity), 'INVOICE',
         v_invoice_id, max(x.unit_cost), null
  from jsonb_to_recordset(p_items) as x(
    product_id bigint,
    quantity numeric,
    unit text,
    unit_price numeric,
    line_total numeric,
    unit_cost numeric,
    cogs_total numeric
  )
  group by x.product_id;

  update public.inventory i
  set quantity = i.quantity - x.required_quantity,
      updated_at = now()
  from (
    select product_id, sum(quantity) as required_quantity
    from jsonb_to_recordset(p_items) as y(
      product_id bigint,
      quantity numeric,
      unit text,
      unit_price numeric,
      line_total numeric,
      unit_cost numeric,
      cogs_total numeric
    )
    group by product_id
  ) x
  where i.product_id = x.product_id and i.warehouse_id = p_warehouse_id;

  insert into public.customer_ledger_entries (
    customer_id, entry_type, reference_type, reference_id, debit, credit,
    currency_code, entry_date, description
  ) values (
    p_customer_id, 'INVOICE', 'INVOICE', v_invoice_id, v_payable, 0,
    p_currency_code, p_issue_date, 'Invoice receivable including pass-through rent'
  );

  insert into public.accounting_journal_entries (entry_date, source_type, source_id, description)
  values (p_issue_date, 'INVOICE', v_invoice_id, 'Invoice sale')
  returning id into v_journal_id;

  insert into public.accounting_journal_lines (journal_entry_id, account_code, debit, credit, description)
  values
    (v_journal_id, 'AR', v_payable, 0, 'Customer receivable'),
    (v_journal_id, 'SALES_REVENUE', 0, p_grand_total, 'Product sales revenue'),
    (v_journal_id, 'COGS', v_cogs, 0, 'Cost of goods sold'),
    (v_journal_id, 'INVENTORY', 0, v_cogs, 'Inventory credit');

  if p_pass_through_rent > 0 then
    insert into public.accounting_journal_lines (
      journal_entry_id, account_code, debit, credit, description
    ) values (
      v_journal_id, 'RENT_PAYABLE', 0, p_pass_through_rent, 'Pass-through rent payable'
    );
  end if;

  insert into public.sales_transaction_idempotency_keys (
    principal_id, idempotency_key, invoice_id
  ) values (p_principal_id, p_idempotency_key, v_invoice_id);

  return v_invoice_id;
end;
$$;

revoke all on function public.record_sale_transaction(text,bigint,bigint,date,text,text,bigint,bigint,numeric,numeric,numeric,numeric,jsonb,text,text) from public, anon, authenticated;
