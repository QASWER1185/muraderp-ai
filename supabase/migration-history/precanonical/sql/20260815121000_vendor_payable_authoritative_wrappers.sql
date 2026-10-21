-- Phase 9: make the existing purchase/payment RPCs the authoritative
-- integration boundary while preserving their public signatures.

alter function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)
  rename to record_purchase_core;

alter function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text)
  rename to record_vendor_payment_core;

create or replace function public.record_purchase(
  p_vendor_id bigint,
  p_warehouse_id bigint,
  p_items jsonb,
  p_purchase_date date default current_date,
  p_invoice_number text default null,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_notes text default null,
  p_idempotency_principal text default null,
  p_idempotency_operation text default 'purchase.create',
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_purchase_id bigint;
  v_total numeric;
  v_subtotal numeric;
  v_tax numeric;
  v_purchase_date date;
  v_journal_id bigint;
begin
  v_result := public.record_purchase_core(
    p_vendor_id,p_warehouse_id,p_items,p_purchase_date,p_invoice_number,
    p_discount,p_tax,p_notes,p_idempotency_principal,p_idempotency_operation,
    p_idempotency_key,p_request_fingerprint
  );

  v_purchase_id := (v_result->'response_body'->'data'->'purchase'->>'id')::bigint;
  select total, subtotal, tax, purchase_date
    into v_total, v_subtotal, v_tax, v_purchase_date
  from public.purchases where id = v_purchase_id;

  insert into public.vendor_payable_ledger_entries(
    vendor_id,entry_type,reference_type,reference_id,debit,credit,entry_date,description
  ) values (
    p_vendor_id,'PURCHASE','PURCHASE',v_purchase_id,0,v_total,v_purchase_date,'Purchase payable'
  ) on conflict (entry_type,reference_type,reference_id) do nothing;

  insert into public.accounting_journal_entries(entry_date,source_type,source_id,description)
  values(v_purchase_date,'PURCHASE',v_purchase_id,'Purchase payable')
  on conflict(source_type,source_id) do nothing
  returning id into v_journal_id;

  if v_journal_id is not null then
    insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description)
    values
      (v_journal_id,'1200',greatest(v_subtotal-coalesce(p_discount,0),0),0,'Inventory from purchase'),
      (v_journal_id,'1300',coalesce(v_tax,0),0,'Input tax from purchase'),
      (v_journal_id,'2000',0,v_total,'Vendor accounts payable');
  end if;

  return v_result;
end;
$$;

create or replace function public.record_vendor_payment(
  p_vendor_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_allocations jsonb,
  p_payment_date date default current_date,
  p_reference text default null,
  p_notes text default null,
  p_principal_scope text default 'service_role',
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id bigint;
  v_journal_id bigint;
  v_account_code text;
begin
  v_payment_id := public.record_vendor_payment_core(
    p_vendor_id,p_amount,p_payment_method,p_allocations,p_payment_date,
    p_reference,p_notes,p_principal_scope,p_idempotency_key,p_request_fingerprint
  );

  insert into public.vendor_payable_ledger_entries(
    vendor_id,entry_type,reference_type,reference_id,debit,credit,entry_date,description
  ) values (
    p_vendor_id,'PAYMENT','VENDOR_PAYMENT',v_payment_id,p_amount,0,
    coalesce(p_payment_date,current_date),'Vendor payment against payable'
  ) on conflict (entry_type,reference_type,reference_id) do nothing;

  v_account_code := case p_payment_method
    when 'CASH' then '1000'
    when 'BANK' then '1010'
    else '1090'
  end;

  insert into public.accounting_journal_entries(entry_date,source_type,source_id,description)
  values(coalesce(p_payment_date,current_date),'VENDOR_PAYMENT',v_payment_id,'Vendor payment')
  on conflict(source_type,source_id) do nothing
  returning id into v_journal_id;

  if v_journal_id is not null then
    insert into public.accounting_journal_lines(journal_entry_id,account_code,debit,credit,description)
    values
      (v_journal_id,'2000',p_amount,0,'Reduce vendor accounts payable'),
      (v_journal_id,v_account_code,0,p_amount,'Vendor payment funding account');
  end if;

  return v_payment_id;
end;
$$;

revoke all on function public.record_purchase_core(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_vendor_payment_core(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) to service_role;
revoke all on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) to service_role;
