-- Phase 16 audit remediation.
-- Preserve the already-applied Phase 16 migration and add organization-scoped
-- foreign-key integrity as a forward-only migration.

alter table public.bank_accounts
  add constraint bank_accounts_org_id_unique unique (organization_id, id);

alter table public.bank_transactions
  drop constraint if exists bank_transactions_bank_account_id_fkey;

alter table public.bank_transactions
  add constraint bank_transactions_account_org_fk
  foreign key (organization_id, bank_account_id)
  references public.bank_accounts (organization_id, id);

alter table public.reconciliation_sessions
  drop constraint if exists reconciliation_sessions_bank_account_id_fkey;

alter table public.reconciliation_sessions
  add constraint reconciliation_account_org_fk
  foreign key (organization_id, bank_account_id)
  references public.bank_accounts (organization_id, id);
