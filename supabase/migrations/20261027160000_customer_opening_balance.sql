alter table public.customers
  add column if not exists opening_balance numeric(14, 2) not null default 0;
