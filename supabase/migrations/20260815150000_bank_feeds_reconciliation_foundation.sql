-- Phase 16: Bank Feeds & Bank Reconciliation Foundation.
-- Financial posting remains owned by existing accounting services.
-- These tables store bank-feed evidence and reconciliation decisions only.

create table if not exists public.bank_accounts (
  id bigint generated always as identity primary key,
  organization_id text not null check (btrim(organization_id) <> ''),
  name text not null check (btrim(name) <> ''),
  account_number_masked text,
  currency text not null check (btrim(currency) <> ''),
  provider text,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bank_accounts_org_id_unique unique (organization_id, id)
);

create index if not exists bank_accounts_org_idx on public.bank_accounts (organization_id);

create table if not exists public.bank_transactions (
  id bigint generated always as identity primary key,
  organization_id text not null check (btrim(organization_id) <> ''),
  bank_account_id bigint not null,
  external_id text not null check (btrim(external_id) <> ''),
  booked_at timestamp with time zone not null,
  amount numeric(20,4) not null check (amount > 0),
  currency text not null check (btrim(currency) <> ''),
  transaction_type text not null check (transaction_type in ('credit','debit')),
  description text not null default '',
  source_hash text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint bank_transactions_account_org_fk
    foreign key (organization_id, bank_account_id)
    references public.bank_accounts(organization_id, id),
  constraint bank_transactions_external_unique unique (organization_id, bank_account_id, external_id)
);

create index if not exists bank_transactions_account_date_idx
  on public.bank_transactions (organization_id, bank_account_id, booked_at desc);

create table if not exists public.reconciliation_sessions (
  id bigint generated always as identity primary key,
  organization_id text not null check (btrim(organization_id) <> ''),
  bank_account_id bigint not null,
  period_from date not null,
  period_to date not null,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint reconciliation_account_org_fk
    foreign key (organization_id, bank_account_id)
    references public.bank_accounts(organization_id, id),
  constraint reconciliation_period_valid check (period_to >= period_from)
);

create index if not exists reconciliation_sessions_org_account_idx
  on public.reconciliation_sessions (organization_id, bank_account_id, period_from, period_to);

create table if not exists public.reconciliation_matches (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.reconciliation_sessions(id) on delete cascade,
  transaction_id bigint not null references public.bank_transactions(id),
  target_type text not null check (target_type in ('customer_receipt','vendor_payment','ledger_entry')),
  target_id text not null check (btrim(target_id) <> ''),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  rationale text not null check (btrim(rationale) <> ''),
  confirmed_by text not null check (btrim(confirmed_by) <> ''),
  confirmed_at timestamp with time zone not null default now(),
  unique (session_id, transaction_id)
);

create index if not exists reconciliation_matches_transaction_idx
  on public.reconciliation_matches (transaction_id);

-- This phase deliberately does not create financial ledger postings or grant
-- public/anon write access. The privileged ERP repository is the mutation boundary.
revoke all on table public.bank_accounts, public.bank_transactions,
  public.reconciliation_sessions, public.reconciliation_matches from public, anon, authenticated;
