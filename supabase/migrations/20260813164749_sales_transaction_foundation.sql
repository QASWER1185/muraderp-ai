create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  invoice_number text not null,
  customer_id bigint not null references public.customers (id),
  source_estimate_id bigint references public.estimates (id),
  source_type text not null check (source_type in ('DIRECT', 'FROM_ESTIMATE')),
  issue_date date not null,
  currency_code text not null,
  status text not null check (status in ('POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID')),
  subtotal numeric not null check (subtotal >= 0),
  discount_total numeric not null default 0 check (discount_total >= 0),
  grand_total numeric not null check (grand_total >= 0),
  pass_through_rent numeric not null default 0 check (pass_through_rent >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_invoice_number_unique unique (invoice_number),
  constraint invoices_discount_not_above_subtotal check (discount_total <= subtotal)
);
create table if not exists public.invoice_items (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.invoices (id) on delete cascade,
  line_number integer not null check (line_number > 0),
  product_id bigint not null references public.products (id),
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0),
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  cogs_total numeric check (cogs_total is null or cogs_total >= 0),
  pricing_source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_items_line_unique unique (invoice_id, line_number),
  constraint invoice_items_total_matches check (line_total = quantity * unit_price),
  constraint invoice_items_cogs_matches check ((unit_cost is null and cogs_total is null) or (unit_cost is not null and cogs_total = quantity * unit_cost))
);
create table if not exists public.customer_ledger_entries (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id),
  entry_type text not null check (entry_type in ('INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'DEBIT_NOTE', 'ADJUSTMENT')),
  reference_type text not null,
  reference_id bigint not null,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  currency_code text not null,
  entry_date date not null default current_date,
  description text,
  created_at timestamptz not null default now(),
  constraint customer_ledger_entry_side check (not (debit > 0 and credit > 0)),
  constraint customer_ledger_reference_unique unique (entry_type, reference_type, reference_id)
);
create table if not exists public.accounting_journal_entries (
  id bigint generated always as identity primary key,
  entry_date date not null default current_date,
  source_type text not null,
  source_id bigint not null,
  description text,
  created_at timestamptz not null default now(),
  constraint accounting_journal_source_unique unique (source_type, source_id)
);
create table if not exists public.accounting_journal_lines (
  id bigint generated always as identity primary key,
  journal_entry_id bigint not null references public.accounting_journal_entries (id) on delete cascade,
  account_code text not null,
  debit numeric not null default 0 check (debit >= 0),
  credit numeric not null default 0 check (credit >= 0),
  description text,
  created_at timestamptz not null default now(),
  constraint accounting_journal_line_side check (not (debit > 0 and credit > 0))
);
create table if not exists public.sales_transaction_idempotency_keys (
  id bigint generated always as identity primary key,
  principal_id text not null,
  idempotency_key text not null,
  invoice_id bigint references public.invoices (id),
  created_at timestamptz not null default now(),
  constraint sales_transaction_idempotency_unique unique (principal_id, idempotency_key)
);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);
create index if not exists invoices_issue_date_idx on public.invoices (issue_date);
create index if not exists invoices_source_estimate_idx on public.invoices (source_estimate_id);
create index if not exists invoice_items_invoice_id_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_product_id_idx on public.invoice_items (product_id);
create index if not exists customer_ledger_customer_date_idx on public.customer_ledger_entries (customer_id, entry_date);
create index if not exists journal_lines_entry_idx on public.accounting_journal_lines (journal_entry_id);
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.customer_ledger_entries enable row level security;
alter table public.accounting_journal_entries enable row level security;
alter table public.accounting_journal_lines enable row level security;
alter table public.sales_transaction_idempotency_keys enable row level security;
revoke all on public.invoices from anon, authenticated;
revoke all on public.invoice_items from anon, authenticated;
revoke all on public.customer_ledger_entries from anon, authenticated;
revoke all on public.accounting_journal_entries from anon, authenticated;
revoke all on public.accounting_journal_lines from anon, authenticated;
revoke all on public.sales_transaction_idempotency_keys from anon, authenticated;