create table if not exists public.vendor_payments (
  id bigint generated always as identity primary key,
  vendor_id bigint not null references public.vendors(id),
  payment_date date not null default current_date,
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('CASH','BANK','OTHER')),
  reference text,
  notes text,
  status text not null default 'POSTED' check (status in ('POSTED','VOIDED')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);
create table if not exists public.vendor_payment_allocations (
  id bigint generated always as identity primary key,
  payment_id bigint not null references public.vendor_payments(id) on delete cascade,
  purchase_id bigint not null references public.purchases(id),
  amount numeric not null check (amount > 0),
  created_at timestamp with time zone not null default now(),
  constraint vendor_payment_allocation_unique unique (payment_id, purchase_id)
);
create table if not exists public.vendor_payment_idempotency_keys (
  id bigint generated always as identity primary key,
  principal_scope text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  payment_id bigint references public.vendor_payments(id),
  created_at timestamp with time zone not null default now(),
  constraint vendor_payment_idempotency_unique unique (principal_scope, idempotency_key),
  constraint vendor_payment_idempotency_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint vendor_payment_fingerprint_not_blank check (btrim(request_fingerprint) <> '')
);
create index if not exists vendor_payments_vendor_id_idx on public.vendor_payments(vendor_id);
create index if not exists vendor_payments_payment_date_idx on public.vendor_payments(payment_date);
create index if not exists vendor_payment_allocations_payment_id_idx on public.vendor_payment_allocations(payment_id);
create index if not exists vendor_payment_allocations_purchase_id_idx on public.vendor_payment_allocations(purchase_id);
create or replace function public.record_vendor_payment(
  p_vendor_id bigint,p_amount numeric,p_payment_method text,p_allocations jsonb,p_payment_date date default current_date,p_reference text default null,p_notes text default null,p_principal_scope text default 'service_role',p_idempotency_key text default null,p_request_fingerprint text default null)
returns bigint language plpgsql security invoker set search_path = '' as $$
declare v_payment_id bigint; v_allocated numeric := 0; v_item_count integer;
begin
  if p_vendor_id is null then raise exception 'Vendor is required' using errcode='22023'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Payment amount must be greater than zero' using errcode='22023'; end if;
  if p_payment_method not in ('CASH','BANK','OTHER') then raise exception 'Unsupported payment method' using errcode='22023'; end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations)=0 then raise exception 'A vendor payment must contain at least one allocation' using errcode='22023'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or nullif(btrim(p_request_fingerprint),'') is null then raise exception 'Idempotency-Key and request fingerprint are required' using errcode='22023'; end if;
  perform 1 from public.vendors where id=p_vendor_id; if not found then raise exception 'Vendor does not exist' using errcode='23503'; end if;
  select count(*),coalesce(sum(item.amount),0) into v_item_count,v_allocated from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric);
  if v_item_count <> jsonb_array_length(p_allocations) then raise exception 'Every allocation must be an object' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric) where item.purchase_id is null or item.amount is null or item.amount<=0) then raise exception 'Every allocation needs a purchase and positive amount' using errcode='22023'; end if;
  if v_allocated <> p_amount then raise exception 'Allocated amount must equal payment amount' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric) where not exists(select 1 from public.purchases p where p.id=item.purchase_id and p.vendor_id=p_vendor_id)) then raise exception 'Allocations must reference purchases for the selected vendor' using errcode='23503'; end if;
  if exists(select 1 from public.vendor_payment_idempotency_keys where principal_scope=p_principal_scope and idempotency_key=p_idempotency_key) then
    select payment_id into v_payment_id from public.vendor_payment_idempotency_keys where principal_scope=p_principal_scope and idempotency_key=p_idempotency_key and request_fingerprint=p_request_fingerprint;
    if v_payment_id is null then raise exception 'Idempotency-Key was already used for a different request' using errcode='P0001'; end if;
    return v_payment_id;
  end if;
  insert into public.vendor_payments(vendor_id,payment_date,amount,payment_method,reference,notes) values(p_vendor_id,coalesce(p_payment_date,current_date),p_amount,p_payment_method,nullif(btrim(p_reference),''),nullif(btrim(p_notes),'')) returning id into v_payment_id;
  insert into public.vendor_payment_allocations(payment_id,purchase_id,amount) select v_payment_id,item.purchase_id,item.amount from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric);
  insert into public.vendor_payment_idempotency_keys(principal_scope,idempotency_key,request_fingerprint,payment_id) values(p_principal_scope,p_idempotency_key,p_request_fingerprint,v_payment_id);
  return v_payment_id;
exception when unique_violation then raise exception 'Vendor payment idempotency request is already being processed' using errcode='P0003';
end; $$;
revoke all on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) to service_role;
alter table public.vendor_payments enable row level security;
alter table public.vendor_payments force row level security;
alter table public.vendor_payment_allocations enable row level security;
alter table public.vendor_payment_allocations force row level security;
alter table public.vendor_payment_idempotency_keys enable row level security;
alter table public.vendor_payment_idempotency_keys force row level security;
create policy backend_only on public.vendor_payments for all to anon,authenticated using(false) with check(false);
create policy backend_only on public.vendor_payment_allocations for all to anon,authenticated using(false) with check(false);
create policy backend_only on public.vendor_payment_idempotency_keys for all to anon,authenticated using(false) with check(false);