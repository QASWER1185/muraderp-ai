-- Phase 10 security hardening: financial reporting views and mutation RPCs must not be callable by anonymous or authenticated clients directly.

alter view public.trial_balance set (security_invoker = true);
alter view public.general_ledger set (security_invoker = true);

revoke execute on function public.assert_journal_entry_balanced(uuid) from public;
revoke execute on function public.post_journal_entry(date, text, text, uuid, text, jsonb) from public;
