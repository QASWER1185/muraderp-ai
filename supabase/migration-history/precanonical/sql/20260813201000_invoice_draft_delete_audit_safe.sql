-- Preserve the audit event when a draft invoice is hard-deleted.
-- The invoice itself is deleted, while the deletion event remains with a null invoice_id.
alter table public.invoice_transaction_events drop constraint if exists invoice_transaction_events_invoice_id_fkey;
alter table public.invoice_transaction_events alter column invoice_id drop not null;
alter table public.invoice_transaction_events add constraint invoice_transaction_events_invoice_id_fkey foreign key (invoice_id) references public.invoices(id) on delete set null;
