-- Phase 9 security hardening: vendor payable ledger is backend-only.

alter table public.vendor_payable_ledger_entries enable row level security;
alter table public.vendor_payable_ledger_entries force row level security;

drop policy if exists backend_only on public.vendor_payable_ledger_entries;
create policy backend_only on public.vendor_payable_ledger_entries
  for all to anon,authenticated using(false) with check(false);

revoke all on public.vendor_payable_ledger_entries from anon,authenticated;
revoke all on public.vendor_payable_balances from anon,authenticated;
grant select on public.vendor_payable_balances to service_role;

alter view public.vendor_payable_balances set (security_invoker=true);
