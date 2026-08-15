-- Phase 8: Accounting Ledger & Financial Reporting Foundation
-- Authoritative double-entry accounting primitives. Existing business transaction
-- boundaries remain responsible for posting journals; clients cannot mutate journals directly.

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  account_type text not null check (account_type in ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  normal_balance text not null check (normal_balance in ('DEBIT','CREDIT')),
  is_active boolean not null default true,
  parent_account_id uuid references public.accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  description text not null,
  source_type text not null,
  source_id uuid,
  idempotency_key text,
  status text not null default 'POSTED' check (status in ('POSTED','VOIDED')),
  created_at timestamptz not null default now(),
  unique (source_type, source_id),
  unique (idempotency_key)
);

create table if not exists public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.journal_entries(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  debit numeric(20,4) not null default 0 check (debit >= 0),
  credit numeric(20,4) not null default 0 check (credit >= 0),
  memo text,
  created_at timestamptz not null default now(),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index if not exists idx_journal_entries_date on public.journal_entries(entry_date);
create index if not exists idx_journal_entries_source on public.journal_entries(source_type, source_id);
create index if not exists idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_journal_lines_account on public.journal_lines(account_id);

create or replace function public.assert_journal_entry_balanced(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric(20,4);
  v_credit numeric(20,4);
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_debit, v_credit
  from public.journal_lines
  where journal_entry_id = p_entry_id;

  if v_debit <= 0 or v_debit <> v_credit then
    raise exception 'journal entry must be balanced and non-zero';
  end if;
end;
$$;

create or replace function public.post_journal_entry(
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_idempotency_key text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_existing uuid;
  v_line jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'journal requires at least two lines';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.journal_entries where idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
  end if;

  if p_source_id is not null then
    select id into v_existing from public.journal_entries
    where source_type = p_source_type and source_id = p_source_id;
    if v_existing is not null then return v_existing; end if;
  end if;

  insert into public.journal_entries(entry_date, description, source_type, source_id, idempotency_key)
  values (p_entry_date, p_description, p_source_type, p_source_id, p_idempotency_key)
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric,0),
      coalesce((v_line->>'credit')::numeric,0),
      v_line->>'memo'
    );
  end loop;

  perform public.assert_journal_entry_balanced(v_entry_id);
  return v_entry_id;
exception when others then
  raise;
end;
$$;

create or replace view public.trial_balance as
select
  a.id as account_id,
  a.code,
  a.name,
  a.account_type,
  a.normal_balance,
  coalesce(sum(jl.debit),0)::numeric(20,4) as total_debit,
  coalesce(sum(jl.credit),0)::numeric(20,4) as total_credit,
  (coalesce(sum(jl.debit),0) - coalesce(sum(jl.credit),0))::numeric(20,4) as net_balance
from public.accounts a
left join public.journal_lines jl on jl.account_id = a.id
left join public.journal_entries je on je.id = jl.journal_entry_id and je.status = 'POSTED'
group by a.id, a.code, a.name, a.account_type, a.normal_balance;

create or replace view public.general_ledger as
select
  je.id as journal_entry_id,
  je.entry_date,
  je.description,
  je.source_type,
  je.source_id,
  a.id as account_id,
  a.code,
  a.name,
  jl.debit,
  jl.credit,
  jl.memo
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.accounts a on a.id = jl.account_id
where je.status = 'POSTED';

-- Prevent direct browser mutations; the server transaction boundary owns posting.
revoke all on public.accounts from anon, authenticated;
revoke all on public.journal_entries from anon, authenticated;
revoke all on public.journal_lines from anon, authenticated;

insert into public.accounts(code,name,account_type,normal_balance) values
('1000','Cash','ASSET','DEBIT'),
('1100','Accounts Receivable','ASSET','DEBIT'),
('1200','Inventory','ASSET','DEBIT'),
('2000','Accounts Payable','LIABILITY','CREDIT'),
('3000','Owner Equity','EQUITY','CREDIT'),
('4000','Sales Revenue','REVENUE','CREDIT'),
('5000','Cost of Goods Sold','EXPENSE','DEBIT')
on conflict (code) do nothing;
