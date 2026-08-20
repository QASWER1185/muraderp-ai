-- Phase 4 production-readiness hardening
-- Backend-only ERP tables must remain inaccessible to anon/authenticated clients.
-- service_role/backend paths bypass RLS as designed.

create policy backend_only on public.accounting_journal_entries
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.accounting_journal_lines
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.accounts
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.ai_copilot_actions
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.credit_note_idempotency_keys
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.credit_note_items
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.credit_notes
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.customer_ledger_entries
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.customer_payment_allocations
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.customer_payment_idempotency_keys
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.customer_payments
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.invoice_items
  for all to anon, authenticated using (false) with_check (false);
create policy backend_only on public.invoice_transaction_events
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.invoices
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.journal_entries
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.journal_lines
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.sales_transaction_idempotency_keys
  for all to anon, authenticated using (false) with check (false);
create policy backend_only on public.salespeople
  for all to anon, authenticated using (false) with check (false);
