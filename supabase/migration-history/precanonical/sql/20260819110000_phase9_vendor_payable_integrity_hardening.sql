-- Phase 9 active-audit remediation.
-- Hardens vendor payment allocation integrity and prevents over-allocation.
-- Purchase remains the authoritative inventory mutation boundary.

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
security invoker
set search_path = public
as $$
declare
  v_payment_id bigint;
  v_allocated numeric := 0;
  v_item_count integer;
  v_purchase_count integer;
  v_invalid_count integer;
  v_overallocated_count integer;
begin
  if p_vendor_id is null then
    raise exception 'Vendor is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero' using errcode = '22023';
  end if;
  if p_payment_method not in ('CASH','BANK','OTHER') then
    raise exception 'Unsupported payment method' using errcode = '22023';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'A vendor payment must contain at least one allocation' using errcode = '22023';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or nullif(btrim(p_request_fingerprint), '') is null then
    raise exception 'Idempotency-Key and request fingerprint are required' using errcode = '22023';
  end if;

  -- Idempotent replay is resolved before business-state validation so the same
  -- request deterministically returns its original payment.
  if exists (
    select 1 from public.vendor_payment_idempotency_keys
    where principal_scope = p_principal_scope and idempotency_key = p_idempotency_key
  ) then
    select payment_id into v_payment_id
    from public.vendor_payment_idempotency_keys
    where principal_scope = p_principal_scope
      and idempotency_key = p_idempotency_key
      and request_fingerprint = p_request_fingerprint;
    if v_payment_id is null then
      raise exception 'Idempotency-Key was already used for a different request' using errcode = 'P0001';
    end if;
    return v_payment_id;
  end if;

  perform 1 from public.vendors where id = p_vendor_id;
  if not found then
    raise exception 'Vendor does not exist' using errcode = '23503';
  end if;

  select count(*), count(distinct item.purchase_id), coalesce(sum(item.amount),0)
  into v_item_count, v_purchase_count, v_allocated
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric);

  if v_item_count <> jsonb_array_length(p_allocations) then
    raise exception 'Every allocation must be an object' using errcode = '22023';
  end if;
  if v_item_count <> v_purchase_count then
    raise exception 'A purchase may appear only once in a vendor payment allocation' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric)
    where item.purchase_id is null or item.amount is null or item.amount <= 0
  ) then
    raise exception 'Every allocation needs a purchase and positive amount' using errcode = '22023';
  end if;
  if v_allocated <> p_amount then
    raise exception 'Allocated amount must equal payment amount' using errcode = '22023';
  end if;

  -- Lock every referenced purchase before calculating remaining payable so two
  -- concurrent payments cannot over-allocate the same purchase.
  perform 1
  from public.purchases p
  where p.id in (select item.purchase_id from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric))
  order by p.id
  for update;

  select count(*)
  into v_invalid_count
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric)
  left join public.purchases p on p.id = item.purchase_id
  where p.id is null or p.vendor_id <> p_vendor_id;
  if v_invalid_count > 0 then
    raise exception 'Every allocation must reference an existing purchase for the selected vendor' using errcode = '23503';
  end if;

  select count(*)
  into v_overallocated_count
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric)
  join public.purchases p on p.id = item.purchase_id
  left join lateral (
    select coalesce(sum(vpa.amount),0) as allocated
    from public.vendor_payment_allocations vpa
    join public.vendor_payments vp on vp.id = vpa.payment_id
    where vpa.purchase_id = p.id and vp.status = 'POSTED'
  ) paid on true
  where item.amount > greatest(p.total - paid.allocated, 0);
  if v_overallocated_count > 0 then
    raise exception 'One or more purchase allocations exceed the remaining payable balance' using errcode = 'P0002';
  end if;

  insert into public.vendor_payments(vendor_id,payment_date,amount,payment_method,reference,notes)
  values(p_vendor_id,coalesce(p_payment_date,current_date),p_amount,p_payment_method,nullif(btrim(p_reference),''),nullif(btrim(p_notes),''))
  returning id into v_payment_id;

  insert into public.vendor_payment_allocations(payment_id,purchase_id,amount)
  select v_payment_id,item.purchase_id,item.amount
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint, amount numeric);

  insert into public.vendor_payment_idempotency_keys(principal_scope,idempotency_key,request_fingerprint,payment_id)
  values(p_principal_scope,p_idempotency_key,p_request_fingerprint,v_payment_id);

  return v_payment_id;
exception
  when unique_violation then
    raise exception 'Vendor payment idempotency request is already being processed' using errcode = 'P0003';
end;
$$;

revoke all on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) to service_role;
