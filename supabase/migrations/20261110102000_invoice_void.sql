alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check check(status in ('DRAFT','POSTED','PARTIALLY_PAID','PAID','VOID','VOIDED'));
create function public.void_invoice_scoped(p_id bigint,p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_principal text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.invoices%rowtype; j public.journal_entries%rowtype; reversal uuid; movement record;
begin
  if not public.is_organization_member_for_user(p_actor_user_id,p_organization_id) then raise exception using errcode='42501',message='Active organization membership required';end if;
  select * into i from public.invoices where id=p_id and organization_id=p_organization_id and branch_id=p_branch_id for update;
  if not found then return false;end if;
  if i.status in ('VOID','VOIDED') then return true;end if;
  if i.status<>'POSTED' then raise exception using errcode='23514',message='Only an unpaid posted invoice can be voided. Drafts can be deleted.';end if;
  if exists(select 1 from public.customer_payment_allocations where invoice_id=p_id) or exists(select 1 from public.credit_notes where invoice_id=p_id) then raise exception using errcode='23514',message='Cannot void: linked payments or returns exist.';end if;
  select * into j from public.journal_entries where organization_id=p_organization_id and branch_id=p_branch_id and source_type='INVOICE' and source_record_id=p_id::text and posting_kind='PRIMARY' and status='POSTED' for update;
  if not found then raise exception using errcode='23514',message='Invoice has no authoritative posted journal; reversal requires reconciliation.';end if;
  -- Reverse actual immutable entries, preserving all original rates and totals.
  insert into public.journal_entries(organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status,reversal_of_journal_entry_id)
  values(p_organization_id,p_branch_id,p_actor_user_id,current_date,'Void invoice '||i.invoice_number,'INVOICE',p_id::text,'REVERSAL',p_principal,'sales.invoice.void','void-invoice-'||p_id,md5(j.id::text),'DRAFT',j.id) returning id into reversal;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) select reversal,account_id,credit,debit,'Invoice void reversal' from public.journal_lines where journal_entry_id=j.id;
  perform public.assert_journal_entry_balanced(reversal);
  update public.journal_entries set status='POSTED' where id=reversal;
  for movement in select product_id,warehouse_id,sum(quantity) quantity from public.stock_movements where organization_id=p_organization_id and branch_id=p_branch_id and reference_type='INVOICE' and reference_id=p_id and movement_type='SALE' group by product_id,warehouse_id order by product_id,warehouse_id loop
    update public.inventory set quantity=quantity+movement.quantity,updated_at=now() where organization_id=p_organization_id and product_id=movement.product_id and warehouse_id=movement.warehouse_id;
    if not found then raise exception using errcode='23514',message='Missing stock balance for invoice reversal';end if;
    insert into public.stock_movements(organization_id,branch_id,product_id,warehouse_id,movement_type,quantity,reference_type,reference_id,notes) values(p_organization_id,p_branch_id,movement.product_id,movement.warehouse_id,'SALE_RETURN',movement.quantity,'INVOICE_VOID',p_id,'Invoice void reversal');
  end loop;
  insert into public.customer_ledger_entries(organization_id,branch_id,customer_id,entry_type,reference_type,reference_id,debit,credit,currency_code,entry_date,description) select organization_id,branch_id,customer_id,'CREDIT_NOTE','INVOICE_VOID',p_id,credit,debit,currency_code,current_date,'Invoice void reversal' from public.customer_ledger_entries where organization_id=p_organization_id and reference_type='INVOICE' and reference_id=p_id and entry_type='INVOICE';
  update public.invoices set status='VOIDED',updated_at=now() where id=p_id;
  insert into public.invoice_transaction_events(invoice_id,event_type,principal_id) values(p_id,'VOIDED',p_principal);
  return true;
end $$;
revoke all on function public.void_invoice_scoped(bigint,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.void_invoice_scoped(bigint,uuid,uuid,uuid,text) to service_role;
create function private.reject_voided_invoice_allocation() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare state text;
begin
  select status into state from public.invoices where id=new.invoice_id for update;
  if state in ('VOID','VOIDED') then raise exception using errcode='23514',message='Cannot allocate a payment or return to a voided invoice';end if;
  return new;
end $$;
create trigger customer_payment_void_guard before insert or update on public.customer_payment_allocations for each row execute function private.reject_voided_invoice_allocation();
create trigger credit_note_void_guard before insert or update on public.credit_notes for each row execute function private.reject_voided_invoice_allocation();
