-- MuradERP-AI quotation foundation.
-- A quotation is a new commercial document derived from an approved estimate.
create table if not exists public.quotations (
  id bigint generated always as identity primary key,
  source_estimate_id bigint not null references public.estimates (id),
  customer_id bigint not null references public.customers (id),
  quotation_number text not null check (btrim(quotation_number) <> ''),
  issue_date date not null,
  currency_code text not null default 'PKR' check (btrim(currency_code) <> ''),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CONVERTED', 'CANCELLED')),
  notes text,
  pass_through_rent numeric not null default 0 check (pass_through_rent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotations_number_unique unique (quotation_number)
);

create index if not exists quotations_customer_date_idx
  on public.quotations (customer_id, issue_date desc);

create index if not exists quotations_source_estimate_idx
  on public.quotations (source_estimate_id);

create table if not exists public.quotation_items (
  id bigint generated always as identity primary key,
  quotation_id bigint not null references public.quotations (id) on delete cascade,
  line_number integer not null check (line_number > 0),
  product_id bigint not null references public.products (id),
  description text,
  quantity numeric not null check (quantity > 0),
  unit text not null check (btrim(unit) <> ''),
  unit_price numeric not null check (unit_price >= 0),
  discount_amount numeric not null default 0 check (discount_amount >= 0),
  pricing_source text not null default 'RESOLVED_RATE'
    check (pricing_source in ('RESOLVED_RATE', 'MANUAL_OVERRIDE')),
  rate_list_id bigint references public.rate_lists (id),
  rate_list_version_id bigint references public.rate_list_versions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotation_items_line_unique unique (quotation_id, line_number)
);

create index if not exists quotation_items_quotation_idx
  on public.quotation_items (quotation_id, line_number);

alter table public.quotations enable row level security;
alter table public.quotations force row level security;
alter table public.quotation_items enable row level security;
alter table public.quotation_items force row level security;

drop policy if exists backend_only on public.quotations;
create policy backend_only on public.quotations
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists backend_only on public.quotation_items;
create policy backend_only on public.quotation_items
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.quotations from anon, authenticated;
revoke all on table public.quotation_items from anon, authenticated;
grant select, insert, update, delete on table public.quotations to service_role;
grant select, insert, update, delete on table public.quotation_items to service_role;
grant usage, select on sequence public.quotations_id_seq to service_role;
grant usage, select on sequence public.quotation_items_id_seq to service_role;
