-- Phase 7A hardening: serialize customer-payment idempotency keys.
-- The original transaction is atomic, but concurrent first-use requests with the
-- same (principal, operation, key) could race on the unique constraint and return
-- a generic duplicate-record error instead of deterministic idempotent replay.
-- A transaction-scoped advisory lock closes that race without weakening atomicity.

create or replace function public.record_customer_payment(
  p_customer_id bigint,
  p_payment_date date,
  p_amount numeric,
  p_currency_code text,
  p_payment_method text,
  p_reference_number text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_principal_scope text default 'internal-system',
  p_operation text default 'customer-payment.create',
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment_id bigint;
  v_existing_payment_id bigint;
  v_allocation jsonb;
  v_invoice_id bigint;
  v_allocation_amount numeric;
  v_total_allocated numeric := 0;
  v_invoice_total numeric;
  v_invoice_paid numeric;
  v_invoice_customer bigint;
  v_invoice_status text;
  v_remaining numeric;
  v_journal_id bigint;
  v_cash_account text;
  v_result jsonb;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception using errcode = '22023', message = 'A valid Idempotency-Key is required';
  end if;

  if p_request_fingerprint is null or length(trim(p_request_fingerprint)) = 0 then
    raise exception using errcode = '22023', message = 'A request fingerprint is required';
  end if;

  if p_amount <= 0 then
    raise exception using errcode = '22023', message = 'Payment amount must be greater than zero';
  end if;

  -- Serialize first-use/replay decisions for the exact idempotency scope.
  -- The lock is transaction-scoped and released automatically on commit/rollback.
  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws(chr(0), p_principal_scope, p_operation, p_idempotency_key),
      0
    )
  );

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception using errcode = '23503', message = 'Customer was not found';
  end if;

  select payment_id
    into v_existing_payment_id
    from public.customer_payment_idempotency_keys
   where principal_scope = p_principal_scope
     and operation = p_operation
     and idempotency_key = p_idempotency_key
   for update;

  if v_existing_payment_id is not null then
    if exists (
      select 1 from public.customer_payment_idempotency_keys
       where principal_scope = p_principal_scope
         and operation = p_operation
         and idempotency_key = p_idempotency_key
         and request_fingerprint <> p_request_fingerprint
    ) then
      raise exception using errcode = 'P0001', message = 'The Idempotency-Key was already used for a different payment request';
    end if;

    select jsonb_build_object(
      'payment', to_jsonb(cp),
      'allocations', coalesce((select jsonb_agg(to_jsonb(cpa) order by cpa.id)
        from public.customer_payment_allocations cpa where cpa.payment_id = cp.id), '[]'::jsonb)
    ) into v_result
    from public.customer_payments cp
    where cp.id = v_existing_payment_id;
    return v_result;
  end if;

  insert into public.customer_payment_idempotency_keys(
    principal_scope, operation, idempotency_key, request_fingerprint
  ) values (
    p_principal_scope, p_operation, p_idempotency_key, p_request_fingerprint
  );

  for v_allocation in select * from jsonb_array_elements(p_allocations)
  loop
    v_invoice_id := (v_allocation->>'invoice_id')::bigint;
    v_allocation_amount := (v_allocation->>'amount')::numeric;

    if v_allocation_amount <= 0 then
      raise exception using errcode = '22023', message = 'Payment allocation must be greater than zero';
    end if;

    select i.customer_id, i.grand_total, i.status,
           coalesce(sum(cpa.amount), 0)
      into v_invoice_customer, v_invoice_total, v_invoice_status, v_invoice_paid
      from public.invoices i
      left join public.customer_payment_allocations cpa on cpa.invoice_id = i.id
     where i.id = v_invoice_id
     group by i.id;

    if v_invoice_customer is null then
      raise exception using errcode = '23503', message = 'Invoice was not found';
    end if;
    if v_invoice_customer <> p_customer_id then
      raise exception using errcode = '22023', message = 'Payment allocation customer does not match invoice customer';
    end if;
    if v_invoice_status = 'VOID' then
      raise exception using errcode = '22023', message = 'Cannot allocate payment to a void invoice';
    end if;

    v_remaining := v_invoice_total - v_invoice_paid;
    if v_allocation_amount > v_remaining then
      raise exception using errcode = 'P0002', message = 'Payment allocation exceeds invoice outstanding balance';
    end if;

    v_total_allocated := v_total_allocated + v_allocation_amount;
  end loop;

  if v_total_allocated <> p_amount then
    raise exception using errcode = '22023', message = 'Payment amount must equal the total invoice allocations';
  end if;

  insert into public.customer_payments(
    customer_id, payment_date, amount, currency_code, payment_method, reference_number, notes
  ) values (
    p_customer_id, p_payment_date, p_amount, p_currency_code, p_payment_method, p_reference_number, p_notes
  ) returning id into v_payment_id;

  for v_allocation in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.customer_payment_allocations(payment_id, invoice_id, amount)
    values (
      v_payment_id,
      (v_allocation->>'invoice_id')::bigint,
      (v_allocation->>'amount')::numeric
    );
  end loop;

  for v_invoice_id in
    select distinct (value->>'invoice_id')::bigint from jsonb_array_elements(p_allocations)
  loop
    select i.grand_total, coalesce(sum(cpa.amount), 0)
      into v_invoice_total, v_invoice_paid
      from public.invoices i
      left join public.customer_payment_allocations cpa on cpa.invoice_id = i.id
     where i.id = v_invoice_id
     group by i.id;

    update public.invoices
       set status = case
         when v_invoice_paid >= v_invoice_total then 'PAID'
         when v_invoice_paid > 0 then 'PARTIALLY_PAID'
         else 'POSTED'
       end,
       updated_at = now()
     where id = v_invoice_id;
  end loop;

  insert into public.customer_ledger_entries(
    customer_id, entry_type, reference_type, reference_id, debit, credit,
    currency_code, entry_date, description
  ) values (
    p_customer_id, 'PAYMENT', 'CUSTOMER_PAYMENT', v_payment_id, 0, p_amount,
    p_currency_code, p_payment_date, coalesce(p_notes, 'Customer payment')
  );

  v_cash_account := case p_payment_method
    when 'CASH' then 'CASH'
    else 'BANK'
  end;

  insert into public.accounting_journal_entries(
    entry_date, source_type, source_id, description
  ) values (
    p_payment_date, 'CUSTOMER_PAYMENT', v_payment_id, coalesce(p_notes, 'Customer payment')
  ) returning id into v_journal_id;

  insert into public.accounting_journal_lines(journal_entry_id, account_code, debit, credit, description)
  values
    (v_journal_id, v_cash_account, p_amount, 0, 'Customer payment received'),
    (v_journal_id, 'ACCOUNTS_RECEIVABLE', 0, p_amount, 'Customer receivable settled');

  update public.customer_payment_idempotency_keys
     set payment_id = v_payment_id
   where principal_scope = p_principal_scope
     and operation = p_operation
     and idempotency_key = p_idempotency_key;

  select jsonb_build_object(
    'payment', to_jsonb(cp),
    'allocations', coalesce((select jsonb_agg(to_jsonb(cpa) order by cpa.id)
      from public.customer_payment_allocations cpa where cpa.payment_id = cp.id), '[]'::jsonb)
  ) into v_result
  from public.customer_payments cp
  where cp.id = v_payment_id;

  return v_result;
end;
$$;

revoke all on function public.record_customer_payment(bigint, date, numeric, text, text, text, text, jsonb, text, text, text, text)
  from public, anon, authenticated;
