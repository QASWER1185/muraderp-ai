-- Salesperson attribution is part of the authoritative invoice transaction.
-- Keep the entity separate from authentication so future staff/auth changes do not
-- alter historical sales attribution semantics.
create table if not exists public.salespeople (
  id bigint generated always as identity primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices
  add column if not exists salesperson_id bigint references public.salespeople (id);

create index if not exists invoices_salesperson_id_idx
  on public.invoices (salesperson_id);

alter table public.salespeople enable row level security;
revoke all on public.salespeople from anon, authenticated;
