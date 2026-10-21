-- MuradERP-AI Estimate foundation.
create table if not exists public.estimates (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id),
  estimate_number text not null check (btrim(estimate_number) <> ''),
  issue_date date not null,
  currency_code text not null default 'PKR' check (btrim(currency_code) <> ''),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'CONVERTED', 'CANCELLED')),
  notes text,
  source_type text not null default 'MANUAL' check (source_type in ('MANUAL', 'OCR', 'VOICE', 'IMPORT', 'AI_ASSISTED')),
  source_reference text,
  layout_key text not null default 'CLASSIC_PAKISTAN' check (layout_key in ('CLASSIC_PAKISTAN', 'MODERN_PAKISTAN', 'COMPACT_TRADE', 'DETAILED_COMMERCIAL', 'MINIMAL_CLEAN')),
  pass_through_rent numeric not null default 0 check (pass_through_rent >= 0),
  pass_through_rent_payee text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimates_number_unique unique (estimate_number)
);
create index if not exists estimates_customer_date_idx on public.estimates (customer_id, issue_date desc);
create index if not exists estimates_status_idx on public.estimates (status);
create table if not exists public.estimate_items (
  id bigint generated always as identity primary key,
  estimate_id bigint not null references public.estimates (id) on delete cascade,
  line_number integer not null check (line_number > 0),
  product_id bigint not null references public.products (id),
  description text,
  quantity numeric not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  unit_price numeric not null check (unit_price >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  pricing_source text not null default 'RESOLVED_RATE' check (pricing_source in ('RESOLVED_RATE', 'MANUAL_OVERRIDE')),
  rate_list_id bigint references public.rate_lists (id),
  rate_list_version_id bigint references public.rate_list_versions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_items_line_unique unique (estimate_id, line_number)
);
create index if not exists estimate_items_estimate_idx on public.estimate_items (estimate_id, line_number);
alter table public.estimates enable row level security;
alter table public.estimates force row level security;
alter table public.estimate_items enable row level security;
alter table public.estimate_items force row level security;
drop policy if exists backend_only on public.estimates;
create policy backend_only on public.estimates for all to anon, authenticated using (false) with check (false);
drop policy if exists backend_only on public.estimate_items;
create policy backend_only on public.estimate_items for all to anon, authenticated using (false) with check (false);
revoke all on table public.estimates from anon, authenticated;
revoke all on table public.estimate_items from anon, authenticated;
grant select, insert, update, delete on table public.estimates to service_role;
grant select, insert, update, delete on table public.estimate_items to service_role;
grant usage, select on sequence public.estimates_id_seq to service_role;
grant usage, select on sequence public.estimate_items_id_seq to service_role;