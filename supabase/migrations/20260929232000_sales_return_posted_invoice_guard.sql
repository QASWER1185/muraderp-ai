-- A credit note may reverse only a posted invoice in the same workspace.
-- Keep this invariant at the database boundary used by every return caller.
create or replace function private.assert_sales_return_posted_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice_status text;
begin
  select i.status into invoice_status
  from public.invoices i
  where i.id = new.invoice_id
    and i.customer_id = new.customer_id
    and i.organization_id = new.organization_id
    and i.branch_id = new.branch_id
  for key share;

  if invoice_status is null then
    raise exception using errcode = '42501', message = 'Invoice is outside the authorized customer or workspace';
  end if;
  if invoice_status not in ('POSTED', 'PARTIALLY_PAID', 'PAID') then
    raise exception using errcode = '22023', message = 'Only posted invoices can be returned';
  end if;
  return new;
end;
$$;
create trigger sales_return_posted_invoice_guard
before insert or update of invoice_id, customer_id, organization_id, branch_id
on public.credit_notes
for each row execute function private.assert_sales_return_posted_invoice();
