-- STEP 6 P0-6: Service-Principal Security Foundation
-- Forward-only privilege hardening only. No business rows, ownership rows,
-- users, credentials, memberships, organizations, or branches are created or modified.

-- Preserve historical transaction bodies as private implementation functions, while
-- replacing their service-facing names with explicit fail-closed wrappers. This avoids
-- blind SECURITY DEFINER/INVOKER conversion and removes reachable default identities.
do $$
begin
  if to_regprocedure('public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)') is null
     or to_regprocedure('public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text)') is null
     or to_regprocedure('public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text)') is null
     or to_regprocedure('public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text)') is null
     or to_regprocedure('public.post_invoice_atomic(jsonb,jsonb,bigint,text,text)') is null then
    raise exception 'P0-6 requires the existing privileged transaction RPC foundation';
  end if;
end
$$;

alter function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) rename to record_purchase_p0_6_impl;
alter function public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) rename to record_customer_payment_p0_6_impl;
alter function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) rename to record_vendor_payment_p0_6_impl;
alter function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) rename to record_sales_return_p0_6_impl;
alter function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) rename to post_invoice_atomic_p0_6_impl;

alter function public.record_purchase_p0_6_impl(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) set search_path = '';
alter function public.record_customer_payment_p0_6_impl(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) set search_path = '';
alter function public.record_vendor_payment_p0_6_impl(bigint,numeric,text,jsonb,date,text,text,text,text,text) set search_path = '';
alter function public.record_sales_return_p0_6_impl(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) set search_path = '';
alter function public.post_invoice_atomic_p0_6_impl(jsonb,jsonb,bigint,text,text) set search_path = '';

revoke all on function public.record_purchase_p0_6_impl(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_customer_payment_p0_6_impl(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_vendor_payment_p0_6_impl(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_sales_return_p0_6_impl(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.post_invoice_atomic_p0_6_impl(jsonb,jsonb,bigint,text,text) from public, anon, authenticated, service_role;

create function public.record_purchase(
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
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_idempotency_principal), '') is null
     or lower(btrim(p_idempotency_principal)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  if p_idempotency_operation is distinct from 'purchase.create' then
    raise exception using errcode='42501', message='Service principal operation is not authorized for purchase RPC';
  end if;
  return public.record_purchase_p0_6_impl(
    p_vendor_id, p_warehouse_id, p_items, p_purchase_date, p_invoice_number,
    p_discount, p_tax, p_notes, p_idempotency_principal, p_idempotency_operation,
    p_idempotency_key, p_request_fingerprint
  );
end;
$$;

create function public.record_customer_payment(
  p_customer_id bigint,
  p_payment_date date,
  p_amount numeric,
  p_currency_code text,
  p_payment_method text,
  p_reference_number text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_principal_scope text default null,
  p_operation text default 'customer-payment.create',
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_principal_scope), '') is null
     or lower(btrim(p_principal_scope)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  if p_operation is distinct from 'customer-payment.create' then
    raise exception using errcode='42501', message='Service principal operation is not authorized for customer payment RPC';
  end if;
  return public.record_customer_payment_p0_6_impl(
    p_customer_id, p_payment_date, p_amount, p_currency_code, p_payment_method,
    p_reference_number, p_notes, p_allocations, p_principal_scope, p_operation,
    p_idempotency_key, p_request_fingerprint
  );
end;
$$;

create function public.record_vendor_payment(
  p_vendor_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_allocations jsonb,
  p_payment_date date default current_date,
  p_reference text default null,
  p_notes text default null,
  p_principal_scope text default null,
  p_idempotency_key text default null,
  p_request_fingerprint text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_principal_scope), '') is null
     or lower(btrim(p_principal_scope)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  return public.record_vendor_payment_p0_6_impl(
    p_vendor_id, p_amount, p_payment_method, p_allocations, p_payment_date,
    p_reference, p_notes, p_principal_scope, p_idempotency_key, p_request_fingerprint
  );
end;
$$;

create function public.record_sales_return(
  p_credit_note_number text,
  p_invoice_id bigint,
  p_customer_id bigint,
  p_credit_date date,
  p_currency_code text,
  p_reason text,
  p_notes text,
  p_items jsonb,
  p_principal_scope text,
  p_operation text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_principal_scope), '') is null
     or lower(btrim(p_principal_scope)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  if p_operation is distinct from 'sales-return.create' then
    raise exception using errcode='42501', message='Service principal operation is not authorized for sales return RPC';
  end if;
  return public.record_sales_return_p0_6_impl(
    p_credit_note_number, p_invoice_id, p_customer_id, p_credit_date,
    p_currency_code, p_reason, p_notes, p_items, p_principal_scope,
    p_operation, p_idempotency_key, p_request_fingerprint
  );
end;
$$;

create function public.post_invoice_atomic(
  p_invoice jsonb,
  p_lines jsonb,
  p_warehouse_id bigint,
  p_principal_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_principal_id), '') is null
     or lower(btrim(p_principal_id)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  return public.post_invoice_atomic_p0_6_impl(p_invoice, p_lines, p_warehouse_id, p_principal_id, p_idempotency_key);
end;
$$;

alter function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) owner to postgres;
alter function public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) owner to postgres;
alter function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) owner to postgres;
alter function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) owner to postgres;
alter function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) owner to postgres;

revoke all on function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) from public, anon, authenticated;
revoke all on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) from public, anon, authenticated;
revoke all on function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) from public, anon, authenticated;
revoke all on function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) from public, anon, authenticated;

grant execute on function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) to service_role;
grant execute on function public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) to service_role;
grant execute on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) to service_role;
grant execute on function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) to service_role;
grant execute on function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) to service_role;

comment on function public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text) is 'P0-6 service_role-only purchase wrapper requiring explicit named service principal.';
comment on function public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text) is 'P0-6 service_role-only customer payment wrapper requiring explicit named service principal.';
comment on function public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text) is 'P0-6 service_role-only vendor payment wrapper requiring explicit named service principal.';
comment on function public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text) is 'P0-6 service_role-only sales return wrapper requiring explicit named service principal.';
comment on function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) is 'P0-6 service_role-only invoice transaction wrapper requiring explicit named service principal.';
