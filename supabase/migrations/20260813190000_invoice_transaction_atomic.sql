-- MuradERP-AI: authoritative Invoice transaction workflow.
-- Invoice is the posting event: there is no separate user-facing Post action.
-- Drafts may be deleted; posted invoices are voided/reversed, never hard-deleted.

alter table public.invoices
  add column if not exists salesperson_id bigint references public.salespeople (id),
  add column if not exists warehouse_id bigint references public.warehouses (id);

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check
  check (status in ('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID'));

create table if not exists public.salespeople (
  id bigint generated always as identity primary key,
  name text not null check (btrim(name) <> ''),
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The FK above is validated after the table exists on fresh databases.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoices_salesperson_id_fkey'
      and conrelid = 'public.invoices'::regclass
  ) then
    alter table public.invoices
      add constraint invoices_salesperson_id_fkey
      foreign key (salesperson_id) references public.salespeople(id);
  end if;
end $$;

create index if not exists invoices_salesperson_id_idx on public.invoices(salesperson_id);
create index if not exists invoices_warehouse_id_idx on public.invoices(warehouse_id);

create table if not exists public.invoice_transaction_events (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices(id),
  event_type text not null check (event_type in ('CREATED', 'POSTED', 'VOIDED', 'DELETED')),
  principal_id text,
  created_at timestamptz not null default now()
);
create index if not exists invoice_transaction_events_invoice_idx
  on public.invoice_transaction_events(invoice_id, created_at);

create or replace function private.create_invoice_draft(
  p_invoice jsonb,
  p_lines jsonb,
  p_principal_id text
)
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice_id bigint;
begin
  if coalesce(trim(p_invoice->>'invoice_number'), '') = '' then
    raise exception using errcode = '22023', message = 'invoice_number is required';
  end if;
  if (p_invoice->>'customer_id')::bigint <= 0 then
    raise exception using errcode = '22023', message = 'customer_id is required';
  end if;
  if jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'invoice must contain at least one line';
  end if;

  insert into public.invoices (
    invoice_number, customer_id, source_estimate_id, source_type,
    issue_date, currency_code, status, subtotal, discount_total,
    grand_total, pass_through_rent, salesperson_id, warehouse_id, notes
  ) values (
    p_invoice->>'invoice_number',
    (p_invoice->>'customer_id')::bigint,
    nullif(p_invoice->>'source_estimate_id','')::bigint,
    coalesce(p_invoice->>'source_type','DIRECT'),
    coalesce((p_invoice->>'issue_date')::date, current_date),
    coalesce(p_invoice->>'currency_code','PKR'),
    'DRAFT',
    coalesce((p_invoice->>'subtotal')::numeric,0),
    coalesce((p_invoice->>'discount_total')::numeric,0),
    coalesce((p_invoice->>'grand_total')::numeric,0),
    coalesce((p_invoice->>'pass_through_rent')::numeric,0),
    nullif(p_invoice->>'salesperson_id','')::bigint,
    nullif(p_invoice->>'warehouse_id','')::bigint,
    p_invoice->>'notes'
  ) returning id into v_invoice_id;

  insert into public.invoice_items (
    invoice_id, line_number, product_id, quantity, unit, unit_price,
    line_total, unit_cost, cogs_total, pricing_source
  )
  select v_invoice_id,
    (x->>'line_number')::integer,
    (x->>'product_id')::bigint,
    (x->>'quantity')::numeric,
    coalesce(x->>'unit','unit'),
    (x->>'unit_price')::numeric,
    (x->>'line_total')::numeric,
    nullif(x->>'unit_cost','')::numeric,
    nullif(x->>'cogs_total','')::numeric,
    coalesce(x->>'pricing_source','MANUAL')
  from jsonb_array_elements(p_lines) x;

  insert into public.invoice_transaction_events(invoice_id,event_type,principal_id)
  values(v_invoice_id,'CREATED',p_principal_id);
  return v_invoice_id;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'invoice number already exists';
end;
$$;

create or replace function private.post_invoice_atomic(
  p_invoice jsonb,
  p_lines jsonb,
  p_warehouse_id bigint,
  p_principal_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice_id bigint;
  v_existing_invoice bigint;
  v_subtotal numeric := coalesce((p_invoice->>'subtotal')::numeric,0);
  v_discount numeric := coalesce((p_invoice->>'discount_total')::numeric,0);
  v_grand_total numeric := coalesce((p_invoice->>'grand_total')::numeric,0);
  v_rent numeric := coalesce((p_invoice->>'pass_through_rent')::numeric,0);
  v_revenue numeric;
  v_cogs numeric := 0;
  v_item jsonb;
  v_inventory public.inventory%rowtype;
  v_unit_cost numeric;
  v_line_total numeric;
  v_journal_id bigint;
begin
  if coalesce(trim(p_idempotency_key),'') = '' then
    raise exception using errcode='22023', message='idempotency_key is required';
  end if;

  select invoice_id into v_existing_invoice
  from public.sales_transaction_idempotency_keys
  where principal_id=p_principal_id and idempotency_key=p_idempotency_key
  for update;
  if v_existing_invoice is not null then
    return jsonb_build_object('invoice_id',v_existing_invoice,'replayed',true);
  end if;

  if p_warehouse_id is null or p_warehouse_id <= 0 then
    raise exception using errcode='22023', message='warehouse_id is required';
  end if;
  if jsonb_array_length(p_lines)=0 then
    raise exception using errcode='22023', message='invoice must contain at least one line';
  end if;
  if v_discount > v_subtotal or v_grand_total <> v_subtotal-v_discount then
    raise exception using errcode='23514', message='invoice totals are inconsistent';
  end if;

  insert into public.invoices(
    invoice_number,customer_id,source_estimate_id,source_type,issue_date,
    currency_code,status,subtotal,discount_total,grand_total,pass_through_rent,
    salesperson_id,warehouse_id,notes
  ) values(
    p_invoice->>'invoice_number',(p_invoice->>'customer_id')::bigint,
    nullif(p_invoice->>'source_estimate_id','')::bigint,
    coalesce(p_invoice->>'source_type','DIRECT'),
    coalesce((p_invoice->>'issue_date')::date,current_date),
    coalesce(p_invoice->>'currency_code','PKR'),'POSTED',v_subtotal,v_discount,
    v_grand_total,v_rent,nullif(p_invoice->>'salesperson_id','')::bigint,
    p_warehouse_id,p_invoice->>'notes'
  ) returning id into v_invoice_id;

  foreach v_item in array (select array_agg(x) from jsonb_array_elements(p_lines) x) loop
    select * into v_inventory
    from public.inventory
    where product_id=(v_item->>'product_id')::bigint and warehouse_id=p_warehouse_id
    for update;
    if not found then
      raise exception using errcode='23503', message='inventory record not found';
    end if;
    if v_inventory.quantity < (v_item->>'quantity')::numeric then
      raise exception using errcode='23514', message='insufficient inventory';
    end if;

    v_unit_cost := coalesce(nullif(v_item->>'unit_cost','')::numeric,
      (select purchase_price from public.products where id=(v_item->>'product_id')::bigint));
    v_line_total := (v_item->>'line_total')::numeric;
    v_cogs := v_cogs + ((v_item->>'quantity')::numeric * v_unit_cost);

    update public.inventory set quantity=quantity-(v_item->>'quantity')::numeric,
      updated_at=now() where id=v_inventory.id;
    insert into public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,unit_cost,notes)
    values((v_item->>'product_id')::bigint,p_warehouse_id,'SALE',(v_item->>'quantity')::numeric,'INVOICE',v_invoice_id,v_unit_cost,'Invoice sale');
    insert into public.invoice_items(invoice_id,line_number,product_id,quantity,unit,unit_price,line_total,unit_cost,cogs_total,pricing_source)
    values(v_invoice_id,(v_item->>'line_number')::integer,(v_item->>'product_id')::bigint,(v_item->>'quantity')::numeric,
      coalesce(v_item->>'unit','unit'),(v_item->>'unit_price')::numeric,v_line_total,v_unit_cost,
      (v_item->>'quantity')::numeric*v_unit_cost,coalesce(v_item->>'pricing_source','MANUAL'));
  end loop;

  v_revenue := v_grand_total;
  insert into public.customer_ledger_entries(customer_id,entry_type,reference_type,reference_id,debit,credit,currency_code,entry_date,description)
  values((p_invoice->>'customer_id')::bigint,'INVOICE','INVOICE',v_invoice_id,v_grand_total+v_rent,0,coalesce(p_invoice->>'currency_code','PKR'),current_date,'Invoice receivable');

  insert into public.accounting_journal_entries(entry_date,source_type,source_id,description)
  values(current_date,'INVOICE',v_invoice_id,'Invoice sale') returning id into v_journal_id;
  insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description) values
    (v_journal_id,'AR',v_grand_total+v_rent,0,'Customer receivable'),
    (v_journal_id,'SALES_REVENUE',0,v_revenue,'Product revenue'),
    (v_journal_id,'COGS',v_cogs,0,'Cost of goods sold'),
    (v_journal_id,'INVENTORY',0,v_cogs,'Inventory reduction');
  if v_rent > 0 then
    insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description)
    values(v_journal_id,'RENT_RECEIVABLE',v_rent,0,'Pass-through rent received from customer'),
          (v_journal_id,'RENT_PAYABLE',0,v_rent,'Pass-through rent payable');
  end if;

  insert into public.sales_transaction_idempotency_keys(principal_id,idempotency_key,invoice_id)
  values(p_principal_id,p_idempotency_key,v_invoice_id);
  insert into public.invoice_transaction_events(invoice_id,event_type,principal_id)
  values(v_invoice_id,'POSTED',p_principal_id);

  return jsonb_build_object('invoice_id',v_invoice_id,'replayed',false,'revenue',v_revenue,'cogs',v_cogs,'rent',v_rent);
exception when unique_violation then
  raise exception using errcode='23505', message='duplicate invoice or idempotency key';
end;
$$;

create or replace function private.delete_invoice_draft(
  p_invoice_id bigint,
  p_principal_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare v_status text;
begin
  select status into v_status from public.invoices where id=p_invoice_id for update;
  if not found then return false; end if;
  if v_status <> 'DRAFT' then
    raise exception using errcode='23514', message='only draft invoices can be deleted; posted invoices must be voided';
  end if;
  insert into public.invoice_transaction_events(invoice_id,event_type,principal_id)
  values(p_invoice_id,'DELETED',p_principal_id);
  delete from public.invoices where id=p_invoice_id;
  return true;
end;
$$;

create or replace function private.void_invoice_atomic(
  p_invoice_id bigint,
  p_principal_id text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_invoice public.invoices%rowtype;
  v_item record;
  v_journal_id bigint;
  v_original_journal_id bigint;
  v_cogs numeric := 0;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then return false; end if;
  if v_invoice.status='VOID' then return true; end if;
  if v_invoice.status='DRAFT' then
    raise exception using errcode='23514', message='draft invoices should be deleted, not voided';
  end if;

  for v_item in select * from public.invoice_items where invoice_id=p_invoice_id order by line_number loop
    update public.inventory set quantity=quantity+v_item.quantity, updated_at=now()
      where product_id=v_item.product_id and warehouse_id=v_invoice.warehouse_id;
    if not found then
      raise exception using errcode='23503', message='inventory record not found for invoice reversal';
    end if;
    insert into public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,unit_cost,notes)
    values(v_item.product_id,v_invoice.warehouse_id,'SALE_RETURN',v_item.quantity,'INVOICE',p_invoice_id,v_item.unit_cost,'Invoice void reversal');
    v_cogs := v_cogs + coalesce(v_item.cogs_total,0);
  end loop;

  insert into public.customer_ledger_entries(customer_id,entry_type,reference_type,reference_id,debit,credit,currency_code,entry_date,description)
  values(v_invoice.customer_id,'CREDIT_NOTE','INVOICE',p_invoice_id,0,v_invoice.grand_total+v_invoice.pass_through_rent,v_invoice.currency_code,current_date,'Invoice void reversal');

  insert into public.accounting_journal_entries(entry_date,source_type,source_id,description)
  values(current_date,'INVOICE_VOID',p_invoice_id,'Invoice void reversal') returning id into v_journal_id;
  insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description) values
    (v_journal_id,'SALES_REVENUE',v_invoice.grand_total,0,'Reverse product revenue'),
    (v_journal_id,'AR',0,v_invoice.grand_total+v_invoice.pass_through_rent,'Reverse receivable'),
    (v_journal_id,'INVENTORY',v_cogs,0,'Restore inventory value'),
    (v_journal_id,'COGS',0,v_cogs,'Reverse COGS');
  if v_invoice.pass_through_rent > 0 then
    insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description) values
      (v_journal_id,'RENT_PAYABLE',v_invoice.pass_through_rent,0,'Reverse rent payable'),
      (v_journal_id,'RENT_RECEIVABLE',0,v_invoice.pass_through_rent,'Reverse rent receivable');
  end if;

  update public.invoices set status='VOID', updated_at=now() where id=p_invoice_id;
  insert into public.invoice_transaction_events(invoice_id,event_type,principal_id)
  values(p_invoice_id,'VOIDED',p_principal_id);
  return true;
end;
$$;

revoke all on function private.create_invoice_draft(jsonb,jsonb,text) from public, anon, authenticated;
revoke all on function private.post_invoice_atomic(jsonb,jsonb,bigint,text,text) from public, anon, authenticated;
revoke all on function private.delete_invoice_draft(bigint,text) from public, anon, authenticated;
revoke all on function private.void_invoice_atomic(bigint,text) from public, anon, authenticated;
