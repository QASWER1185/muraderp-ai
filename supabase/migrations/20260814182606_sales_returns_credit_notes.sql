-- MuradERP-AI Phase 7B: Sales Returns & Credit Notes.
create table if not exists public.credit_notes (
  id bigint generated always as identity primary key,
  credit_note_number text not null unique,
  invoice_id bigint not null references public.invoices (id),
  customer_id bigint not null references public.customers (id),
  credit_date date not null,
  currency_code text not null,
  status text not null check (status in ('POSTED', 'VOID')),
  subtotal numeric not null check (subtotal >= 0),
  grand_total numeric not null check (grand_total >= 0),
  reason text not null check (btrim(reason) <> ''),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.credit_note_items (
  id bigint generated always as identity primary key,
  credit_note_id bigint not null references public.credit_notes (id) on delete cascade,
  invoice_item_id bigint not null references public.invoice_items (id),
  product_id bigint not null references public.products (id),
  warehouse_id bigint not null references public.warehouses (id),
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total = quantity * unit_price),
  unit_cost numeric not null check (unit_cost >= 0),
  cogs_reversal_total numeric not null check (cogs_reversal_total = quantity * unit_cost),
  created_at timestamptz not null default now(),
  constraint credit_note_item_unique_invoice_line unique (credit_note_id, invoice_item_id)
);
create table if not exists public.credit_note_idempotency_keys (
  id bigint generated always as identity primary key,
  principal_scope text not null,
  operation text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  credit_note_id bigint references public.credit_notes (id),
  created_at timestamptz not null default now(),
  constraint credit_note_idempotency_unique unique (principal_scope, operation, idempotency_key)
);
create index if not exists credit_notes_invoice_id_idx on public.credit_notes (invoice_id);
create index if not exists credit_notes_customer_date_idx on public.credit_notes (customer_id, credit_date);
create index if not exists credit_note_items_credit_note_idx on public.credit_note_items (credit_note_id);
create index if not exists credit_note_items_invoice_item_idx on public.credit_note_items (invoice_item_id);
create index if not exists credit_note_items_product_warehouse_idx on public.credit_note_items (product_id, warehouse_id);
alter table public.credit_notes enable row level security;
alter table public.credit_note_items enable row level security;
alter table public.credit_note_idempotency_keys enable row level security;
revoke all on public.credit_notes from anon, authenticated;
revoke all on public.credit_note_items from anon, authenticated;
revoke all on public.credit_note_idempotency_keys from anon, authenticated;
create or replace function public.record_sales_return(p_credit_note_number text,p_invoice_id bigint,p_customer_id bigint,p_credit_date date,p_currency_code text,p_reason text,p_notes text,p_items jsonb,p_principal_scope text,p_operation text,p_idempotency_key text,p_request_fingerprint text)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare v_credit_note_id bigint; v_subtotal numeric := 0; v_cogs numeric := 0; v_item jsonb; v_invoice record; v_returned numeric; v_qty numeric; v_line_total numeric; v_journal_id bigint; v_existing record; v_result jsonb;
begin
if btrim(p_credit_note_number) = '' or btrim(p_reason) = '' then raise exception using errcode='22023',message='Credit note number and reason are required'; end if;
if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception using errcode='22023',message='At least one return item is required'; end if;
select * into v_existing from public.credit_note_idempotency_keys where principal_scope=p_principal_scope and operation=p_operation and idempotency_key=p_idempotency_key for update;
if found then
 if v_existing.request_fingerprint <> p_request_fingerprint then raise exception using errcode='P0001',message='Idempotency-Key was reused for a different sales return request'; end if;
 select jsonb_build_object('credit_note',to_jsonb(cn),'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)) into v_result from public.credit_notes cn where cn.id=v_existing.credit_note_id; return v_result;
end if;
select * into v_invoice from public.invoices i where i.id=p_invoice_id and i.customer_id=p_customer_id for update;
if not found then raise exception using errcode='23503',message='Invoice does not belong to the specified customer'; end if;
if v_invoice.status='VOID' then raise exception using errcode='22023',message='Cannot return items from a void invoice'; end if;
insert into public.credit_notes(credit_note_number,invoice_id,customer_id,credit_date,currency_code,status,subtotal,grand_total,reason,notes) values(p_credit_note_number,p_invoice_id,p_customer_id,p_credit_date,upper(btrim(p_currency_code)),'POSTED',0,0,btrim(p_reason),nullif(btrim(p_notes),'')) returning id into v_credit_note_id;
for v_item in select * from jsonb_array_elements(p_items) loop
 select ii.* into v_invoice from public.invoice_items ii where ii.id=(v_item->>'invoice_item_id')::bigint and ii.invoice_id=p_invoice_id for update;
 if not found then raise exception using errcode='23503',message='Invoice item does not belong to the invoice'; end if;
 v_qty:=(v_item->>'quantity')::numeric; if v_qty<=0 then raise exception using errcode='22023',message='Return quantity must be positive'; end if;
 if v_invoice.unit_cost is null then raise exception using errcode='22023',message='Invoice item is missing unit cost; inventory reversal is unsafe'; end if;
 select coalesce(sum(ci.quantity),0) into v_returned from public.credit_note_items ci join public.credit_notes cn on cn.id=ci.credit_note_id where ci.invoice_item_id=v_invoice.id and cn.status='POSTED';
 if v_returned+v_qty>v_invoice.quantity then raise exception using errcode='P0002',message='Return quantity exceeds the remaining invoice quantity'; end if;
 v_line_total:=v_qty*v_invoice.unit_price; v_subtotal:=v_subtotal+v_line_total; v_cogs:=v_cogs+(v_qty*v_invoice.unit_cost);
 insert into public.credit_note_items(credit_note_id,invoice_item_id,product_id,warehouse_id,quantity,unit,unit_price,line_total,unit_cost,cogs_reversal_total) values(v_credit_note_id,v_invoice.id,v_invoice.product_id,(v_item->>'warehouse_id')::bigint,v_qty,v_invoice.unit,v_invoice.unit_price,v_line_total,v_invoice.unit_cost,v_qty*v_invoice.unit_cost);
 insert into public.stock_movements(product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,unit_cost,notes) values(v_invoice.product_id,(v_item->>'warehouse_id')::bigint,'SALE_RETURN',v_qty,'CREDIT_NOTE',v_credit_note_id,v_invoice.unit_cost,'Sales return / credit note');
 insert into public.inventory(product_id,warehouse_id,quantity) values(v_invoice.product_id,(v_item->>'warehouse_id')::bigint,v_qty) on conflict(product_id,warehouse_id) do update set quantity=public.inventory.quantity+excluded.quantity,updated_at=now();
end loop;
update public.credit_notes set subtotal=v_subtotal,grand_total=v_subtotal,updated_at=now() where id=v_credit_note_id;
insert into public.customer_ledger_entries(customer_id,entry_type,reference_type,reference_id,debit,credit,currency_code,entry_date,description) values(p_customer_id,'CREDIT_NOTE','CREDIT_NOTE',v_credit_note_id,0,v_subtotal,upper(btrim(p_currency_code)),p_credit_date,'Sales return credit note');
insert into public.accounting_journal_entries(entry_date,source_type,source_id,description) values(p_credit_date,'CREDIT_NOTE',v_credit_note_id,'Sales return / credit note') returning id into v_journal_id;
insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description) values(v_journal_id,'SALES_RETURNS',v_subtotal,0,'Sales return reversal'),(v_journal_id,'ACCOUNTS_RECEIVABLE',0,v_subtotal,'Customer receivable credit'),(v_journal_id,'INVENTORY',v_cogs,0,'Inventory restored'),(v_journal_id,'COGS',0,v_cogs,'COGS reversal');
insert into public.credit_note_idempotency_keys(principal_scope,operation,idempotency_key,request_fingerprint,credit_note_id) values(p_principal_scope,p_operation,p_idempotency_key,p_request_fingerprint,v_credit_note_id);
select jsonb_build_object('credit_note',to_jsonb(cn),'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)) into v_result from public.credit_notes cn where cn.id=v_credit_note_id; return v_result;
end; $$;
revoke all on function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) from public,anon,authenticated;