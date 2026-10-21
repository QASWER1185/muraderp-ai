-- P0 non-sales transaction convergence.
-- Forward-only correction: no historical rows are backfilled or reassigned.

do $$
begin
  if to_regprocedure('public.is_organization_member_for_user(uuid,uuid)') is null
     or to_regprocedure('public.has_permission_for_user(uuid,uuid,text)') is null
     or to_regprocedure('public.has_branch_access_for_user(uuid,uuid,uuid)') is null
     or to_regprocedure('public.assert_journal_entry_balanced(uuid)') is null
     or to_regclass('public.journal_entries') is null
     or to_regclass('public.journal_lines') is null then
    raise exception 'P0 non-sales convergence requires the P0-5 and P0-8 foundations';
  end if;
end
$$;

-- The P0-8 balance assertion intentionally is not executable by Data API roles.
-- Its deferred constraint trigger can run after a SECURITY DEFINER posting RPC
-- has returned, however, so that trigger must retain the trusted owner context.
alter function private.enforce_authoritative_journal_balance_at_post() security definer;
alter function private.enforce_authoritative_journal_balance_at_post() owner to postgres;

-- Ownership is additive and nullable for preserved legacy rows. New authoritative
-- RPCs below always write a complete organization/branch/actor context.
alter table public.vendors add column if not exists organization_id uuid;
alter table public.vendors
  add constraint vendors_p0_non_sales_organization_fkey
  foreign key (organization_id) references public.organizations(id) on delete restrict;
create index vendors_p0_non_sales_organization_idx on public.vendors(organization_id);

alter table public.purchases
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists service_principal text,
  add column if not exists operation_scope text;
alter table public.customer_payments
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists service_principal text,
  add column if not exists operation_scope text;
alter table public.credit_notes
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists service_principal text,
  add column if not exists operation_scope text;
alter table public.vendor_payments
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists service_principal text,
  add column if not exists operation_scope text;

alter table public.purchases
  add constraint purchases_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint purchases_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint purchases_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint purchases_p0_non_sales_context_check check (
    (organization_id is null and branch_id is null and actor_user_id is null and service_principal is null and operation_scope is null)
    or
    (organization_id is not null and branch_id is not null and actor_user_id is not null and nullif(btrim(service_principal),'') is not null and operation_scope = 'purchase.create')
  );
alter table public.customer_payments
  add constraint customer_payments_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint customer_payments_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint customer_payments_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint customer_payments_p0_non_sales_context_check check (
    (organization_id is null and branch_id is null and actor_user_id is null and service_principal is null and operation_scope is null)
    or
    (organization_id is not null and branch_id is not null and actor_user_id is not null and nullif(btrim(service_principal),'') is not null and operation_scope = 'customer-payment.create')
  );
alter table public.credit_notes
  add constraint credit_notes_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint credit_notes_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint credit_notes_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint credit_notes_p0_non_sales_context_check check (
    (organization_id is null and branch_id is null and actor_user_id is null and service_principal is null and operation_scope is null)
    or
    (organization_id is not null and branch_id is not null and actor_user_id is not null and nullif(btrim(service_principal),'') is not null and operation_scope = 'sales-return.create')
  );
alter table public.vendor_payments
  add constraint vendor_payments_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint vendor_payments_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint vendor_payments_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint vendor_payments_p0_non_sales_context_check check (
    (organization_id is null and branch_id is null and actor_user_id is null and service_principal is null and operation_scope is null)
    or
    (organization_id is not null and branch_id is not null and actor_user_id is not null and nullif(btrim(service_principal),'') is not null and operation_scope = 'vendor-payment.create')
  );

create index purchases_p0_non_sales_scope_idx on public.purchases(organization_id, branch_id, id);
create index customer_payments_p0_non_sales_scope_idx on public.customer_payments(organization_id, branch_id, id);
create index credit_notes_p0_non_sales_scope_idx on public.credit_notes(organization_id, branch_id, id);
create index vendor_payments_p0_non_sales_scope_idx on public.vendor_payments(organization_id, branch_id, id);

-- Child transaction rows carry explicit scope as well as inheriting it from
-- their authoritative header. Legacy child rows remain entirely unscoped.
alter table public.purchase_items add column if not exists organization_id uuid, add column if not exists branch_id uuid;
alter table public.customer_payment_allocations add column if not exists organization_id uuid, add column if not exists branch_id uuid;
alter table public.credit_note_items add column if not exists organization_id uuid, add column if not exists branch_id uuid;
alter table public.vendor_payment_allocations add column if not exists organization_id uuid, add column if not exists branch_id uuid;

alter table public.purchase_items
  add constraint purchase_items_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint purchase_items_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint purchase_items_p0_non_sales_scope_check check ((organization_id is null and branch_id is null) or (organization_id is not null and branch_id is not null));
alter table public.customer_payment_allocations
  add constraint customer_payment_allocations_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint customer_payment_allocations_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint customer_payment_allocations_p0_non_sales_scope_check check ((organization_id is null and branch_id is null) or (organization_id is not null and branch_id is not null));
alter table public.credit_note_items
  add constraint credit_note_items_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint credit_note_items_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint credit_note_items_p0_non_sales_scope_check check ((organization_id is null and branch_id is null) or (organization_id is not null and branch_id is not null));
alter table public.vendor_payment_allocations
  add constraint vendor_payment_allocations_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint vendor_payment_allocations_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint vendor_payment_allocations_p0_non_sales_scope_check check ((organization_id is null and branch_id is null) or (organization_id is not null and branch_id is not null));

create index purchase_items_p0_non_sales_scope_idx on public.purchase_items(organization_id, branch_id, purchase_id);
create index customer_payment_allocations_p0_non_sales_scope_idx on public.customer_payment_allocations(organization_id, branch_id, payment_id);
create index credit_note_items_p0_non_sales_scope_idx on public.credit_note_items(organization_id, branch_id, credit_note_id);
create index vendor_payment_allocations_p0_non_sales_scope_idx on public.vendor_payment_allocations(organization_id, branch_id, payment_id);

alter table public.vendor_payable_ledger_entries
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid;
alter table public.vendor_payable_ledger_entries
  add constraint vendor_payable_ledger_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint vendor_payable_ledger_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint vendor_payable_ledger_p0_non_sales_scope_check check ((organization_id is null and branch_id is null) or (organization_id is not null and branch_id is not null));
create index vendor_payable_ledger_p0_non_sales_scope_idx on public.vendor_payable_ledger_entries(organization_id, branch_id, vendor_id, entry_date, id);

-- Scope the existing idempotency stores. Existing rows remain in a separate
-- legacy namespace and are never replayed by the new tenant-aware RPCs.
alter table public.purchase_idempotency_keys
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists journal_entry_id uuid;
alter table public.customer_payment_idempotency_keys
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists journal_entry_id uuid;
alter table public.credit_note_idempotency_keys
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists journal_entry_id uuid;
alter table public.vendor_payment_idempotency_keys
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists operation text,
  add column if not exists journal_entry_id uuid;

alter table public.purchase_idempotency_keys
  add constraint purchase_idempotency_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint purchase_idempotency_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint purchase_idempotency_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint purchase_idempotency_p0_non_sales_journal_fkey foreign key (journal_entry_id) references public.journal_entries(id) on delete restrict,
  add constraint purchase_idempotency_p0_non_sales_scope_check check ((organization_id is null and branch_id is null and actor_user_id is null and journal_entry_id is null) or (organization_id is not null and branch_id is not null and actor_user_id is not null));
alter table public.customer_payment_idempotency_keys
  add constraint customer_payment_idempotency_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint customer_payment_idempotency_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint customer_payment_idempotency_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint customer_payment_idempotency_p0_non_sales_journal_fkey foreign key (journal_entry_id) references public.journal_entries(id) on delete restrict,
  add constraint customer_payment_idempotency_p0_non_sales_scope_check check ((organization_id is null and branch_id is null and actor_user_id is null and journal_entry_id is null) or (organization_id is not null and branch_id is not null and actor_user_id is not null));
alter table public.credit_note_idempotency_keys
  add constraint credit_note_idempotency_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint credit_note_idempotency_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint credit_note_idempotency_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint credit_note_idempotency_p0_non_sales_journal_fkey foreign key (journal_entry_id) references public.journal_entries(id) on delete restrict,
  add constraint credit_note_idempotency_p0_non_sales_scope_check check ((organization_id is null and branch_id is null and actor_user_id is null and journal_entry_id is null) or (organization_id is not null and branch_id is not null and actor_user_id is not null));
alter table public.vendor_payment_idempotency_keys
  add constraint vendor_payment_idempotency_p0_non_sales_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint vendor_payment_idempotency_p0_non_sales_branch_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint vendor_payment_idempotency_p0_non_sales_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint vendor_payment_idempotency_p0_non_sales_journal_fkey foreign key (journal_entry_id) references public.journal_entries(id) on delete restrict,
  add constraint vendor_payment_idempotency_p0_non_sales_scope_check check ((organization_id is null and branch_id is null and actor_user_id is null and operation is null and journal_entry_id is null) or (organization_id is not null and branch_id is not null and actor_user_id is not null and operation = 'vendor-payment.create'));

alter table public.customer_payment_idempotency_keys drop constraint if exists customer_payment_idempotency_unique;
alter table public.credit_note_idempotency_keys drop constraint if exists credit_note_idempotency_unique;
alter table public.vendor_payment_idempotency_keys drop constraint if exists vendor_payment_idempotency_unique;
drop index if exists public.purchase_idempotency_scope_key_unique_idx;

create unique index purchase_idempotency_p0_non_sales_scoped_key
  on public.purchase_idempotency_keys(organization_id, principal_scope, operation, idempotency_key)
  where organization_id is not null;
create unique index purchase_idempotency_p0_non_sales_legacy_key
  on public.purchase_idempotency_keys(principal_scope, operation, idempotency_key)
  where organization_id is null;
create unique index customer_payment_idempotency_p0_non_sales_scoped_key
  on public.customer_payment_idempotency_keys(organization_id, principal_scope, operation, idempotency_key)
  where organization_id is not null;
create unique index customer_payment_idempotency_p0_non_sales_legacy_key
  on public.customer_payment_idempotency_keys(principal_scope, operation, idempotency_key)
  where organization_id is null;
create unique index credit_note_idempotency_p0_non_sales_scoped_key
  on public.credit_note_idempotency_keys(organization_id, principal_scope, operation, idempotency_key)
  where organization_id is not null;
create unique index credit_note_idempotency_p0_non_sales_legacy_key
  on public.credit_note_idempotency_keys(principal_scope, operation, idempotency_key)
  where organization_id is null;
create unique index vendor_payment_idempotency_p0_non_sales_scoped_key
  on public.vendor_payment_idempotency_keys(organization_id, principal_scope, operation, idempotency_key)
  where organization_id is not null;
create unique index vendor_payment_idempotency_p0_non_sales_legacy_key
  on public.vendor_payment_idempotency_keys(principal_scope, idempotency_key)
  where organization_id is null;

-- Credit-note numbers follow the same tenant-scoped pattern as P0-8 invoice
-- numbers. Legacy unscoped numbers remain unique among legacy rows.
alter table public.credit_notes drop constraint if exists credit_notes_credit_note_number_key;
drop index if exists public.credit_notes_credit_note_number_key;
create unique index credit_notes_p0_non_sales_scoped_number_key
  on public.credit_notes(organization_id, credit_note_number)
  where organization_id is not null;
create unique index credit_notes_p0_non_sales_legacy_number_key
  on public.credit_notes(credit_note_number)
  where organization_id is null;

create or replace function private.assert_authoritative_non_sales_context(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_expected_operation text,
  p_permission_code text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_organization_id is null or p_branch_id is null or p_actor_user_id is null then
    raise exception using errcode='42501', message='organization_id, branch_id, and actor_user_id are required';
  end if;
  if nullif(btrim(p_service_principal), '') is null
     or lower(btrim(p_service_principal)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  if p_operation_scope is distinct from p_expected_operation then
    raise exception using errcode='42501', message='Service principal operation is not authorized for this transaction';
  end if;
  if not public.is_organization_member_for_user(p_actor_user_id, p_organization_id) then
    raise exception using errcode='42501', message='Active organization membership is required';
  end if;
  if not public.has_permission_for_user(p_actor_user_id, p_organization_id, p_permission_code) then
    raise exception using errcode='42501', message='Required organization permission is not granted';
  end if;
  if not public.has_branch_access_for_user(p_actor_user_id, p_organization_id, p_branch_id) then
    raise exception using errcode='42501', message='Explicit active branch grant is required';
  end if;
end;
$$;

alter function private.assert_authoritative_non_sales_context(uuid,uuid,uuid,text,text,text,text)
  owner to postgres;
revoke all on function private.assert_authoritative_non_sales_context(uuid,uuid,uuid,text,text,text,text)
  from public, anon, authenticated, service_role;

create function public.record_purchase(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_vendor_id bigint,
  p_warehouse_id bigint,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_purchase_date date default current_date,
  p_invoice_number text default null,
  p_discount numeric default 0,
  p_tax numeric default 0,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_purchase_id bigint;
  v_journal_entry_id uuid;
  v_existing record;
  v_item_count integer;
  v_distinct_product_count integer;
  v_found_product_count integer;
  v_subtotal numeric;
  v_net_inventory numeric;
  v_total numeric;
  v_normalized_invoice text;
  v_inventory_organization uuid;
  v_inventory_found boolean;
  v_purchase_json jsonb;
  v_items_json jsonb;
  v_response_body jsonb;
  v_inventory_account uuid;
  v_tax_account uuid;
  v_payable_account uuid;
  v_constraint_name text;
begin
  perform private.assert_authoritative_non_sales_context(
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, 'purchase.create', 'purchases.create'
  );

  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 255 then
    raise exception using errcode='22023', message='A valid Idempotency-Key is required';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='A valid request fingerprint is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode='22023', message='A purchase must contain at least one item';
  end if;
  if p_discount is null or p_discount < 0 or p_tax is null or p_tax < 0 then
    raise exception using errcode='22023', message='Discount and tax must be zero or greater';
  end if;

  if not exists (
    select 1 from public.vendors v
    where v.id = p_vendor_id and v.organization_id = p_organization_id
  ) then
    raise exception using errcode='42501', message='vendor ownership is not assigned to the authorized organization';
  end if;
  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.organization_id = p_organization_id
  ) then
    raise exception using errcode='42501', message='warehouse ownership is not assigned to the authorized organization';
  end if;

  select count(*), count(distinct item.product_id), coalesce(sum(item.quantity * item.unit_cost), 0)
    into v_item_count, v_distinct_product_count, v_subtotal
  from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric);

  if v_item_count <> jsonb_array_length(p_items)
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric)
       where item.product_id is null or item.quantity is null or item.quantity <= 0
          or item.unit_cost is null or item.unit_cost < 0
     ) then
    raise exception using errcode='22023', message='Each item needs a product, positive quantity, and nonnegative unit cost';
  end if;

  select count(*) into v_found_product_count
  from public.products p
  where p.organization_id = p_organization_id
    and p.id in (
      select distinct item.product_id
      from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric)
    );
  if v_found_product_count <> v_distinct_product_count then
    raise exception using errcode='42501', message='one or more products are not owned by the authorized organization';
  end if;

  if p_discount > v_subtotal then
    raise exception using errcode='22023', message='Discount cannot exceed the purchase subtotal';
  end if;
  v_net_inventory := v_subtotal - p_discount;
  v_total := v_net_inventory + p_tax;
  if v_total <= 0 then
    raise exception using errcode='22023', message='A posted purchase total must be greater than zero';
  end if;

  -- Stable product locks serialize inventory creation/update for this purchase.
  perform p.id
  from public.products p
  where p.organization_id = p_organization_id
    and p.id in (
      select distinct item.product_id
      from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric)
    )
  order by p.id
  for update;

  for v_existing in
    select distinct item.product_id
    from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric)
    order by item.product_id
  loop
    v_inventory_found := false;
    select i.organization_id, true
      into v_inventory_organization, v_inventory_found
    from public.inventory i
    where i.product_id = v_existing.product_id and i.warehouse_id = p_warehouse_id
    for update;
    if v_inventory_found and v_inventory_organization is distinct from p_organization_id then
      raise exception using errcode='42501', message='inventory ownership is not assigned to the authorized organization';
    end if;
  end loop;

  select a.id into v_inventory_account from public.accounts a where a.code='1200' and a.is_active;
  select a.id into v_tax_account from public.accounts a where a.code='1300' and a.is_active;
  select a.id into v_payable_account from public.accounts a where a.code='2000' and a.is_active;
  if v_inventory_account is null or v_tax_account is null or v_payable_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for purchase posting';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_organization_id, p_service_principal, p_operation_scope, p_idempotency_key)::text,
      0
    )
  );

  select * into v_existing
  from public.purchase_idempotency_keys k
  where k.organization_id = p_organization_id
    and k.principal_scope = p_service_principal
    and k.operation = p_operation_scope
    and k.idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.branch_id is distinct from p_branch_id then
      raise exception using errcode='P0001', message='Idempotency-Key was already used for a different purchase request';
    end if;
    if v_existing.status = 'COMPLETED' then
      if v_existing.purchase_id is null or v_existing.journal_entry_id is null
         or not exists (
           select 1 from public.journal_entries je
           where je.id = v_existing.journal_entry_id
             and je.organization_id = p_organization_id
             and je.branch_id = p_branch_id
             and je.source_type = 'PURCHASE'
             and je.source_record_id = v_existing.purchase_id::text
             and je.posting_kind = 'PRIMARY'
             and je.status = 'POSTED'
         ) then
        raise exception using errcode='23514', message='idempotent purchase replay is missing its authoritative posted journal';
      end if;
      return jsonb_build_object(
        'replayed', true,
        'response_status', v_existing.response_status,
        'response_body', v_existing.response_body
      );
    end if;
    raise exception using errcode='P0003', message='Purchase idempotency request is already being processed';
  end if;

  insert into public.purchase_idempotency_keys(
    organization_id, branch_id, actor_user_id, principal_scope, operation,
    idempotency_key, request_fingerprint, status
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, btrim(p_service_principal),
    p_operation_scope, btrim(p_idempotency_key), p_request_fingerprint, 'PROCESSING'
  );

  v_normalized_invoice := nullif(btrim(p_invoice_number), '');
  begin
    insert into public.purchases(
      organization_id, branch_id, actor_user_id, service_principal, operation_scope,
      vendor_id, warehouse_id, purchase_date, invoice_number, subtotal, discount,
      tax, total, notes
    ) values (
      p_organization_id, p_branch_id, p_actor_user_id, btrim(p_service_principal),
      p_operation_scope, p_vendor_id, p_warehouse_id, coalesce(p_purchase_date,current_date),
      v_normalized_invoice, v_subtotal, p_discount, p_tax, v_total, nullif(btrim(p_notes),'')
    ) returning id into v_purchase_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'purchases_vendor_invoice_unique_idx' then
      raise exception using errcode='P0002', message='The vendor invoice number already exists';
    end if;
    raise;
  end;

  insert into public.purchase_items(
    organization_id, branch_id, purchase_id, product_id, quantity, unit_cost, total_cost
  )
  select p_organization_id, p_branch_id, v_purchase_id, item.product_id,
         item.quantity, item.unit_cost, item.quantity * item.unit_cost
  from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric);

  insert into public.stock_movements(
    organization_id, branch_id, product_id, warehouse_id, movement_type,
    quantity, reference_type, reference_id, unit_cost, notes
  )
  select p_organization_id, p_branch_id, item.product_id, p_warehouse_id,
         'PURCHASE', item.quantity, 'PURCHASE', v_purchase_id, item.unit_cost,
         nullif(btrim(p_notes),'')
  from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric);

  insert into public.inventory as inventory_balance(
    organization_id, product_id, warehouse_id, quantity
  )
  select p_organization_id, item.product_id, p_warehouse_id, sum(item.quantity)
  from jsonb_to_recordset(p_items) as item(product_id bigint, quantity numeric, unit_cost numeric)
  group by item.product_id
  on conflict (product_id, warehouse_id) do update
    set quantity = inventory_balance.quantity + excluded.quantity,
        updated_at = now()
    where inventory_balance.organization_id = excluded.organization_id;

  insert into public.vendor_payable_ledger_entries(
    organization_id, branch_id, vendor_id, entry_type, reference_type,
    reference_id, debit, credit, entry_date, description
  ) values (
    p_organization_id, p_branch_id, p_vendor_id, 'PURCHASE', 'PURCHASE',
    v_purchase_id, 0, v_total, coalesce(p_purchase_date,current_date), 'Purchase payable'
  );

  insert into public.journal_entries(
    organization_id, branch_id, actor_user_id, entry_date, description,
    source_type, source_id, source_record_id, posting_kind, principal_scope,
    operation_scope, idempotency_key, request_fingerprint, status
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, coalesce(p_purchase_date,current_date),
    'Purchase ' || coalesce(v_normalized_invoice, v_purchase_id::text), 'PURCHASE', null,
    v_purchase_id::text, 'PRIMARY', btrim(p_service_principal), p_operation_scope,
    btrim(p_idempotency_key), p_request_fingerprint, 'DRAFT'
  ) returning id into v_journal_entry_id;

  if v_net_inventory > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (v_journal_entry_id, v_inventory_account, v_net_inventory, 0, 'Inventory acquired');
  end if;
  if p_tax > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (v_journal_entry_id, v_tax_account, p_tax, 0, 'Input tax recoverable');
  end if;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
  values (v_journal_entry_id, v_payable_account, 0, v_total, 'Vendor accounts payable');
  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries set status='POSTED' where id=v_journal_entry_id;

  select to_jsonb(p) into v_purchase_json from public.purchases p where p.id=v_purchase_id;
  select coalesce(jsonb_agg(to_jsonb(pi) order by pi.id), '[]'::jsonb)
    into v_items_json from public.purchase_items pi where pi.purchase_id=v_purchase_id;
  v_response_body := jsonb_build_object('data', jsonb_build_object('purchase',v_purchase_json,'items',v_items_json));

  update public.purchase_idempotency_keys
  set status='COMPLETED', purchase_id=v_purchase_id, journal_entry_id=v_journal_entry_id,
      response_status=201, response_body=v_response_body, completed_at=now()
  where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
    and operation=p_operation_scope and idempotency_key=btrim(p_idempotency_key);

  return jsonb_build_object('replayed',false,'response_status',201,'response_body',v_response_body);
end;
$$;

create function public.record_customer_payment(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_customer_id bigint,
  p_payment_date date,
  p_amount numeric,
  p_currency_code text,
  p_payment_method text,
  p_reference_number text,
  p_notes text,
  p_allocations jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payment_id bigint;
  v_journal_entry_id uuid;
  v_existing record;
  v_item record;
  v_item_count integer;
  v_distinct_invoice_count integer;
  v_authorized_invoice_count integer;
  v_total_allocated numeric;
  v_invoice_total numeric;
  v_invoice_paid numeric;
  v_invoice_credited numeric;
  v_remaining numeric;
  v_payment_result jsonb;
  v_cash_account uuid;
  v_ar_account uuid;
begin
  perform private.assert_authoritative_non_sales_context(
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, 'customer-payment.create', 'payments.create'
  );

  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 255 then
    raise exception using errcode='22023', message='A valid Idempotency-Key is required';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='A valid request fingerprint is required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception using errcode='22023', message='Payment amount must be greater than zero';
  end if;
  if p_payment_method not in ('CASH','BANK_TRANSFER','CARD','CHEQUE','OTHER') then
    raise exception using errcode='22023', message='Unsupported customer payment method';
  end if;
  if nullif(btrim(p_currency_code),'') is null then
    raise exception using errcode='22023', message='currency_code is required';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations)=0 then
    raise exception using errcode='22023', message='A customer payment must contain at least one allocation';
  end if;
  if not exists (
    select 1 from public.customers c
    where c.id=p_customer_id and c.organization_id=p_organization_id
  ) then
    raise exception using errcode='42501', message='customer ownership is not assigned to the authorized organization';
  end if;

  select count(*), count(distinct item.invoice_id), coalesce(sum(item.amount),0)
    into v_item_count, v_distinct_invoice_count, v_total_allocated
  from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric);
  if v_item_count <> jsonb_array_length(p_allocations)
     or v_item_count <> v_distinct_invoice_count
     or exists (
       select 1 from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
       where item.invoice_id is null or item.amount is null or item.amount <= 0
     ) then
    raise exception using errcode='22023', message='Each invoice may appear once with a positive allocation amount';
  end if;
  if v_total_allocated <> p_amount then
    raise exception using errcode='22023', message='Payment amount must equal the total invoice allocations';
  end if;

  -- Invoice locks are acquired before any write. They serialize different-key
  -- payments against the same receivable as well as the same-key replay path.
  perform i.id
  from public.invoices i
  where i.id in (
    select item.invoice_id
    from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
  )
  order by i.id
  for update;

  select count(*) into v_authorized_invoice_count
  from public.invoices i
  where i.id in (
      select item.invoice_id
      from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
    )
    and i.customer_id=p_customer_id
    and i.organization_id=p_organization_id
    and i.branch_id=p_branch_id;
  if v_authorized_invoice_count <> v_distinct_invoice_count then
    raise exception using errcode='42501', message='one or more invoices are outside the authorized customer, organization, or branch';
  end if;
  if exists (
    select 1 from public.invoices i
    where i.id in (
      select item.invoice_id
      from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
    ) and i.status='VOID'
  ) then
    raise exception using errcode='22023', message='Cannot allocate payment to a void invoice';
  end if;

  select a.id into v_ar_account from public.accounts a where a.code='1100' and a.is_active;
  select a.id into v_cash_account
  from public.accounts a
  where a.code = case p_payment_method
    when 'CASH' then '1000'
    when 'OTHER' then '1090'
    else '1010'
  end and a.is_active;
  if v_ar_account is null or v_cash_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for customer payment posting';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_organization_id, p_service_principal, p_operation_scope, p_idempotency_key)::text,
      0
    )
  );

  select * into v_existing
  from public.customer_payment_idempotency_keys k
  where k.organization_id=p_organization_id
    and k.principal_scope=p_service_principal
    and k.operation=p_operation_scope
    and k.idempotency_key=p_idempotency_key
  for update;

  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.branch_id is distinct from p_branch_id then
      raise exception using errcode='P0001', message='The Idempotency-Key was already used for a different payment request';
    end if;
    if v_existing.payment_id is null then
      raise exception using errcode='P0003', message='Customer payment idempotency request is already being processed';
    end if;
    if v_existing.journal_entry_id is null
       or not exists (
         select 1 from public.journal_entries je
         where je.id=v_existing.journal_entry_id
           and je.organization_id=p_organization_id
           and je.branch_id=p_branch_id
           and je.source_type='CUSTOMER_PAYMENT'
           and je.source_record_id=v_existing.payment_id::text
           and je.posting_kind='PRIMARY'
           and je.status='POSTED'
       ) then
      raise exception using errcode='23514', message='idempotent customer payment replay is missing its authoritative posted journal';
    end if;
    select jsonb_build_object(
      'payment',to_jsonb(cp),
      'allocations',coalesce((
        select jsonb_agg(to_jsonb(cpa) order by cpa.id)
        from public.customer_payment_allocations cpa
        where cpa.payment_id=cp.id
      ),'[]'::jsonb)
    ) into v_payment_result
    from public.customer_payments cp
    where cp.id=v_existing.payment_id
      and cp.organization_id=p_organization_id
      and cp.branch_id=p_branch_id;
    return v_payment_result;
  end if;

  insert into public.customer_payment_idempotency_keys(
    organization_id, branch_id, actor_user_id, principal_scope, operation,
    idempotency_key, request_fingerprint
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, btrim(p_service_principal),
    p_operation_scope, btrim(p_idempotency_key), p_request_fingerprint
  );

  for v_item in
    select item.invoice_id, item.amount
    from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
    order by item.invoice_id
  loop
    select i.grand_total + i.pass_through_rent,
           coalesce((
             select sum(cpa.amount)
             from public.customer_payment_allocations cpa
             join public.customer_payments cp on cp.id=cpa.payment_id
             where cpa.invoice_id=i.id
               and cp.organization_id=p_organization_id
           ),0),
           coalesce((
             select sum(cn.grand_total)
             from public.credit_notes cn
             where cn.invoice_id=i.id
               and cn.organization_id=p_organization_id
               and cn.status='POSTED'
           ),0)
      into v_invoice_total, v_invoice_paid, v_invoice_credited
    from public.invoices i
    where i.id=v_item.invoice_id;
    v_remaining := v_invoice_total - v_invoice_paid - v_invoice_credited;
    if v_item.amount > v_remaining then
      raise exception using errcode='P0002', message='Payment allocation exceeds invoice outstanding balance';
    end if;
  end loop;

  insert into public.customer_payments(
    organization_id, branch_id, actor_user_id, service_principal, operation_scope,
    customer_id, payment_date, amount, currency_code, payment_method,
    reference_number, notes
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, btrim(p_service_principal),
    p_operation_scope, p_customer_id, coalesce(p_payment_date,current_date), p_amount,
    upper(btrim(p_currency_code)), p_payment_method, nullif(btrim(p_reference_number),''),
    nullif(btrim(p_notes),'')
  ) returning id into v_payment_id;

  insert into public.customer_payment_allocations(
    organization_id, branch_id, payment_id, invoice_id, amount
  )
  select p_organization_id, p_branch_id, v_payment_id, item.invoice_id, item.amount
  from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric);

  for v_item in
    select distinct item.invoice_id
    from jsonb_to_recordset(p_allocations) as item(invoice_id bigint, amount numeric)
    order by item.invoice_id
  loop
    select i.grand_total + i.pass_through_rent,
           coalesce((select sum(cpa.amount) from public.customer_payment_allocations cpa where cpa.invoice_id=i.id),0),
           coalesce((select sum(cn.grand_total) from public.credit_notes cn where cn.invoice_id=i.id and cn.status='POSTED'),0)
      into v_invoice_total, v_invoice_paid, v_invoice_credited
    from public.invoices i where i.id=v_item.invoice_id;
    update public.invoices
    set status=case
      when v_invoice_paid + v_invoice_credited >= v_invoice_total then 'PAID'
      when v_invoice_paid + v_invoice_credited > 0 then 'PARTIALLY_PAID'
      else 'POSTED'
    end,
    updated_at=now()
    where id=v_item.invoice_id and organization_id=p_organization_id and branch_id=p_branch_id;
  end loop;

  insert into public.customer_ledger_entries(
    organization_id, branch_id, customer_id, entry_type, reference_type,
    reference_id, debit, credit, currency_code, entry_date, description
  ) values (
    p_organization_id, p_branch_id, p_customer_id, 'PAYMENT', 'CUSTOMER_PAYMENT',
    v_payment_id, 0, p_amount, upper(btrim(p_currency_code)),
    coalesce(p_payment_date,current_date), coalesce(nullif(btrim(p_notes),''),'Customer payment')
  );

  insert into public.journal_entries(
    organization_id, branch_id, actor_user_id, entry_date, description,
    source_type, source_id, source_record_id, posting_kind, principal_scope,
    operation_scope, idempotency_key, request_fingerprint, status
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, coalesce(p_payment_date,current_date),
    'Customer payment ' || v_payment_id, 'CUSTOMER_PAYMENT', null,
    v_payment_id::text, 'PRIMARY', btrim(p_service_principal), p_operation_scope,
    btrim(p_idempotency_key), p_request_fingerprint, 'DRAFT'
  ) returning id into v_journal_entry_id;
  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo) values
    (v_journal_entry_id, v_cash_account, p_amount, 0, 'Customer payment received'),
    (v_journal_entry_id, v_ar_account, 0, p_amount, 'Customer receivable settled');
  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries set status='POSTED' where id=v_journal_entry_id;

  update public.customer_payment_idempotency_keys
  set payment_id=v_payment_id, journal_entry_id=v_journal_entry_id
  where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
    and operation=p_operation_scope and idempotency_key=btrim(p_idempotency_key);

  select jsonb_build_object(
    'payment',to_jsonb(cp),
    'allocations',coalesce((
      select jsonb_agg(to_jsonb(cpa) order by cpa.id)
      from public.customer_payment_allocations cpa where cpa.payment_id=cp.id
    ),'[]'::jsonb)
  ) into v_payment_result
  from public.customer_payments cp where cp.id=v_payment_id;
  return v_payment_result;
end;
$$;

create function public.record_sales_return(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_credit_note_number text,
  p_invoice_id bigint,
  p_customer_id bigint,
  p_credit_date date,
  p_currency_code text,
  p_reason text,
  p_notes text,
  p_items jsonb,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_credit_note_id bigint;
  v_journal_entry_id uuid;
  v_existing record;
  v_item record;
  v_invoice record;
  v_item_count integer;
  v_distinct_item_count integer;
  v_returned numeric;
  v_subtotal numeric := 0;
  v_cogs numeric := 0;
  v_inventory_organization uuid;
  v_inventory_found boolean;
  v_result jsonb;
  v_ar_account uuid;
  v_inventory_account uuid;
  v_sales_account uuid;
  v_cogs_account uuid;
begin
  perform private.assert_authoritative_non_sales_context(
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, 'sales-return.create', 'returns.create'
  );

  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255 then
    raise exception using errcode='22023', message='A valid Idempotency-Key is required';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='A valid request fingerprint is required';
  end if;
  if nullif(btrim(p_credit_note_number),'') is null or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023', message='Credit note number and reason are required';
  end if;
  if nullif(btrim(p_currency_code),'') is null then
    raise exception using errcode='22023', message='currency_code is required';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception using errcode='22023', message='At least one return item is required';
  end if;

  if not exists (
    select 1 from public.customers c
    where c.id=p_customer_id and c.organization_id=p_organization_id
  ) then
    raise exception using errcode='42501', message='customer ownership is not assigned to the authorized organization';
  end if;

  select i.* into v_invoice
  from public.invoices i
  where i.id=p_invoice_id
  for update;
  if not found
     or v_invoice.customer_id is distinct from p_customer_id
     or v_invoice.organization_id is distinct from p_organization_id
     or v_invoice.branch_id is distinct from p_branch_id then
    raise exception using errcode='42501', message='invoice is outside the authorized customer, organization, or branch';
  end if;
  if v_invoice.status='VOID' then
    raise exception using errcode='22023', message='Cannot return items from a void invoice';
  end if;
  if upper(btrim(p_currency_code)) is distinct from upper(btrim(v_invoice.currency_code)) then
    raise exception using errcode='22023', message='Credit note currency must match the invoice currency';
  end if;

  select count(*), count(distinct item.invoice_item_id)
    into v_item_count, v_distinct_item_count
  from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric);
  if v_item_count <> jsonb_array_length(p_items)
     or v_item_count <> v_distinct_item_count
     or exists (
       select 1
       from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
       where item.invoice_item_id is null or item.warehouse_id is null
          or item.quantity is null or item.quantity <= 0
     ) then
    raise exception using errcode='22023', message='Each invoice item may appear once with a warehouse and positive quantity';
  end if;

  perform ii.id
  from public.invoice_items ii
  where ii.id in (
    select item.invoice_item_id
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
  )
  order by ii.id
  for update;

  if (
    select count(*)
    from public.invoice_items ii
    join jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
      on item.invoice_item_id=ii.id
    where ii.invoice_id=p_invoice_id
  ) <> v_distinct_item_count then
    raise exception using errcode='42501', message='one or more invoice items are outside the authorized invoice';
  end if;

  -- Complete every ownership check before creating an idempotency or business row.
  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit_cost
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    if not exists (
      select 1 from public.products p
      where p.id=v_item.product_id and p.organization_id=p_organization_id
    ) then
      raise exception using errcode='42501', message='product ownership is not assigned to the authorized organization';
    end if;
    if not exists (
      select 1 from public.warehouses w
      where w.id=v_item.warehouse_id and w.organization_id=p_organization_id
    ) then
      raise exception using errcode='42501', message='return warehouse ownership is not assigned to the authorized organization';
    end if;
    if v_item.unit_cost is null then
      raise exception using errcode='22023', message='Invoice item is missing unit cost; inventory reversal is unsafe';
    end if;

    v_inventory_found := false;
    select i.organization_id, true
      into v_inventory_organization, v_inventory_found
    from public.inventory i
    where i.product_id=v_item.product_id and i.warehouse_id=v_item.warehouse_id
    for update;
    if v_inventory_found and v_inventory_organization is distinct from p_organization_id then
      raise exception using errcode='42501', message='inventory ownership is not assigned to the authorized organization';
    end if;
  end loop;

  select a.id into v_ar_account from public.accounts a where a.code='1100' and a.is_active;
  select a.id into v_inventory_account from public.accounts a where a.code='1200' and a.is_active;
  select a.id into v_sales_account from public.accounts a where a.code='4000' and a.is_active;
  select a.id into v_cogs_account from public.accounts a where a.code='5000' and a.is_active;
  if v_ar_account is null or v_inventory_account is null or v_sales_account is null or v_cogs_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for sales return posting';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_organization_id,p_service_principal,p_operation_scope,p_idempotency_key)::text,
      0
    )
  );

  select * into v_existing
  from public.credit_note_idempotency_keys k
  where k.organization_id=p_organization_id
    and k.principal_scope=p_service_principal
    and k.operation=p_operation_scope
    and k.idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.branch_id is distinct from p_branch_id then
      raise exception using errcode='P0001', message='Idempotency-Key was reused for a different sales return request';
    end if;
    if v_existing.credit_note_id is null then
      raise exception using errcode='P0003', message='Sales return idempotency request is already being processed';
    end if;
    if v_existing.journal_entry_id is null
       or not exists (
         select 1 from public.journal_entries je
         where je.id=v_existing.journal_entry_id
           and je.organization_id=p_organization_id
           and je.branch_id=p_branch_id
           and je.source_type='CREDIT_NOTE'
           and je.source_record_id=v_existing.credit_note_id::text
           and je.posting_kind='PRIMARY'
           and je.status='POSTED'
       ) then
      raise exception using errcode='23514', message='idempotent sales return replay is missing its authoritative posted journal';
    end if;
    select jsonb_build_object(
      'credit_note',to_jsonb(cn),
      'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)
    ) into v_result
    from public.credit_notes cn
    where cn.id=v_existing.credit_note_id and cn.organization_id=p_organization_id and cn.branch_id=p_branch_id;
    return v_result;
  end if;

  insert into public.credit_note_idempotency_keys(
    organization_id, branch_id, actor_user_id, principal_scope, operation,
    idempotency_key, request_fingerprint
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),
    p_operation_scope,btrim(p_idempotency_key),p_request_fingerprint
  );

  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit, ii.unit_price, ii.unit_cost, ii.quantity as sold_quantity
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    select coalesce(sum(ci.quantity),0) into v_returned
    from public.credit_note_items ci
    join public.credit_notes cn on cn.id=ci.credit_note_id
    where ci.invoice_item_id=v_item.invoice_item_id and cn.status='POSTED';
    if v_returned + v_item.quantity > v_item.sold_quantity then
      raise exception using errcode='P0002', message='Return quantity exceeds the remaining invoice quantity';
    end if;
    v_subtotal := v_subtotal + (v_item.quantity * v_item.unit_price);
    v_cogs := v_cogs + (v_item.quantity * v_item.unit_cost);
  end loop;
  if v_subtotal + v_cogs <= 0 then
    raise exception using errcode='22023', message='A posted sales return must have a non-zero accounting effect';
  end if;

  insert into public.credit_notes(
    organization_id,branch_id,actor_user_id,service_principal,operation_scope,
    credit_note_number,invoice_id,customer_id,credit_date,currency_code,status,
    subtotal,grand_total,reason,notes
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),p_operation_scope,
    btrim(p_credit_note_number),p_invoice_id,p_customer_id,coalesce(p_credit_date,current_date),
    upper(btrim(p_currency_code)),'POSTED',v_subtotal,v_subtotal,btrim(p_reason),nullif(btrim(p_notes),'')
  ) returning id into v_credit_note_id;

  for v_item in
    select item.invoice_item_id, item.warehouse_id, item.quantity,
           ii.product_id, ii.unit, ii.unit_price, ii.unit_cost
    from jsonb_to_recordset(p_items) as item(invoice_item_id bigint, warehouse_id bigint, quantity numeric)
    join public.invoice_items ii on ii.id=item.invoice_item_id
    order by item.invoice_item_id
  loop
    insert into public.credit_note_items(
      organization_id,branch_id,credit_note_id,invoice_item_id,product_id,warehouse_id,
      quantity,unit,unit_price,line_total,unit_cost,cogs_reversal_total
    ) values (
      p_organization_id,p_branch_id,v_credit_note_id,v_item.invoice_item_id,v_item.product_id,
      v_item.warehouse_id,v_item.quantity,v_item.unit,v_item.unit_price,
      v_item.quantity*v_item.unit_price,v_item.unit_cost,v_item.quantity*v_item.unit_cost
    );
    insert into public.stock_movements(
      organization_id,branch_id,product_id,warehouse_id,movement_type,quantity,
      reference_type,reference_id,unit_cost,notes
    ) values (
      p_organization_id,p_branch_id,v_item.product_id,v_item.warehouse_id,'SALE_RETURN',
      v_item.quantity,'CREDIT_NOTE',v_credit_note_id,v_item.unit_cost,'Sales return / credit note'
    );
    insert into public.inventory as inventory_balance(organization_id,product_id,warehouse_id,quantity)
    values (p_organization_id,v_item.product_id,v_item.warehouse_id,v_item.quantity)
    on conflict(product_id,warehouse_id) do update
      set quantity=inventory_balance.quantity+excluded.quantity,updated_at=now()
      where inventory_balance.organization_id=excluded.organization_id;
  end loop;

  insert into public.customer_ledger_entries(
    organization_id,branch_id,customer_id,entry_type,reference_type,reference_id,
    debit,credit,currency_code,entry_date,description
  ) values (
    p_organization_id,p_branch_id,p_customer_id,'CREDIT_NOTE','CREDIT_NOTE',v_credit_note_id,
    0,v_subtotal,upper(btrim(p_currency_code)),coalesce(p_credit_date,current_date),'Sales return credit note'
  );

  insert into public.journal_entries(
    organization_id,branch_id,actor_user_id,entry_date,description,source_type,
    source_id,source_record_id,posting_kind,principal_scope,operation_scope,
    idempotency_key,request_fingerprint,status
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,coalesce(p_credit_date,current_date),
    'Sales return '||btrim(p_credit_note_number),'CREDIT_NOTE',null,v_credit_note_id::text,
    'PRIMARY',btrim(p_service_principal),p_operation_scope,btrim(p_idempotency_key),
    p_request_fingerprint,'DRAFT'
  ) returning id into v_journal_entry_id;
  if v_subtotal > 0 then
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_journal_entry_id,v_sales_account,v_subtotal,0,'Reverse product sales revenue'),
      (v_journal_entry_id,v_ar_account,0,v_subtotal,'Customer receivable credit');
  end if;
  if v_cogs > 0 then
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_journal_entry_id,v_inventory_account,v_cogs,0,'Inventory restored'),
      (v_journal_entry_id,v_cogs_account,0,v_cogs,'Reverse cost of goods sold');
  end if;
  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries set status='POSTED' where id=v_journal_entry_id;

  update public.credit_note_idempotency_keys
  set credit_note_id=v_credit_note_id,journal_entry_id=v_journal_entry_id
  where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
    and operation=p_operation_scope and idempotency_key=btrim(p_idempotency_key);

  select jsonb_build_object(
    'credit_note',to_jsonb(cn),
    'items',coalesce((select jsonb_agg(to_jsonb(ci) order by ci.id) from public.credit_note_items ci where ci.credit_note_id=cn.id),'[]'::jsonb)
  ) into v_result
  from public.credit_notes cn where cn.id=v_credit_note_id;
  return v_result;
end;
$$;

create function public.record_vendor_payment(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_vendor_id bigint,
  p_amount numeric,
  p_payment_method text,
  p_allocations jsonb,
  p_payment_date date,
  p_reference text,
  p_notes text,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_payment_id bigint;
  v_journal_entry_id uuid;
  v_existing record;
  v_item_count integer;
  v_distinct_purchase_count integer;
  v_authorized_purchase_count integer;
  v_total_allocated numeric;
  v_overallocated_count integer;
  v_funding_account uuid;
  v_payable_account uuid;
begin
  perform private.assert_authoritative_non_sales_context(
    p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,
    p_operation_scope,'vendor-payment.create','payments.create'
  );

  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255 then
    raise exception using errcode='22023', message='A valid Idempotency-Key is required';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023', message='A valid request fingerprint is required';
  end if;
  if p_amount is null or p_amount<=0 then
    raise exception using errcode='22023', message='Payment amount must be greater than zero';
  end if;
  if p_payment_method not in ('CASH','BANK','OTHER') then
    raise exception using errcode='22023', message='Unsupported vendor payment method';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations)<>'array' or jsonb_array_length(p_allocations)=0 then
    raise exception using errcode='22023', message='A vendor payment must contain at least one allocation';
  end if;
  if not exists (
    select 1 from public.vendors v
    where v.id=p_vendor_id and v.organization_id=p_organization_id
  ) then
    raise exception using errcode='42501', message='vendor ownership is not assigned to the authorized organization';
  end if;

  select count(*),count(distinct item.purchase_id),coalesce(sum(item.amount),0)
    into v_item_count,v_distinct_purchase_count,v_total_allocated
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric);
  if v_item_count<>jsonb_array_length(p_allocations)
     or v_item_count<>v_distinct_purchase_count
     or exists(
       select 1 from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric)
       where item.purchase_id is null or item.amount is null or item.amount<=0
     ) then
    raise exception using errcode='22023', message='Each purchase may appear once with a positive allocation amount';
  end if;
  if v_total_allocated<>p_amount then
    raise exception using errcode='22023', message='Allocated amount must equal payment amount';
  end if;

  perform p.id
  from public.purchases p
  where p.id in (
    select item.purchase_id
    from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric)
  )
  order by p.id
  for update;

  select count(*) into v_authorized_purchase_count
  from public.purchases p
  where p.id in (
      select item.purchase_id
      from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric)
    )
    and p.vendor_id=p_vendor_id
    and p.organization_id=p_organization_id
    and p.branch_id=p_branch_id;
  if v_authorized_purchase_count<>v_distinct_purchase_count then
    raise exception using errcode='42501', message='one or more purchases are outside the authorized vendor, organization, or branch';
  end if;

  select a.id into v_payable_account from public.accounts a where a.code='2000' and a.is_active;
  select a.id into v_funding_account
  from public.accounts a
  where a.code=case p_payment_method when 'CASH' then '1000' when 'BANK' then '1010' else '1090' end
    and a.is_active;
  if v_payable_account is null or v_funding_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for vendor payment posting';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(p_organization_id,p_service_principal,p_operation_scope,p_idempotency_key)::text,
      0
    )
  );
  select * into v_existing
  from public.vendor_payment_idempotency_keys k
  where k.organization_id=p_organization_id
    and k.principal_scope=p_service_principal
    and k.operation=p_operation_scope
    and k.idempotency_key=p_idempotency_key
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from p_request_fingerprint
       or v_existing.actor_user_id is distinct from p_actor_user_id
       or v_existing.branch_id is distinct from p_branch_id then
      raise exception using errcode='P0001', message='Idempotency-Key was reused for a different vendor payment request';
    end if;
    if v_existing.payment_id is null then
      raise exception using errcode='P0003', message='Vendor payment idempotency request is already being processed';
    end if;
    if v_existing.journal_entry_id is null
       or not exists (
         select 1 from public.journal_entries je
         where je.id=v_existing.journal_entry_id
           and je.organization_id=p_organization_id
           and je.branch_id=p_branch_id
           and je.source_type='VENDOR_PAYMENT'
           and je.source_record_id=v_existing.payment_id::text
           and je.posting_kind='PRIMARY'
           and je.status='POSTED'
       ) then
      raise exception using errcode='23514', message='idempotent vendor payment replay is missing its authoritative posted journal';
    end if;
    return v_existing.payment_id;
  end if;

  insert into public.vendor_payment_idempotency_keys(
    organization_id,branch_id,actor_user_id,principal_scope,operation,
    idempotency_key,request_fingerprint
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),
    p_operation_scope,btrim(p_idempotency_key),p_request_fingerprint
  );

  select count(*) into v_overallocated_count
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric)
  join public.purchases p on p.id=item.purchase_id
  left join lateral (
    select coalesce(sum(vpa.amount),0) as allocated
    from public.vendor_payment_allocations vpa
    join public.vendor_payments vp on vp.id=vpa.payment_id
    where vpa.purchase_id=p.id and vp.status='POSTED'
  ) paid on true
  where item.amount>greatest(p.total-paid.allocated,0);
  if v_overallocated_count>0 then
    raise exception using errcode='P0002', message='One or more purchase allocations exceed the remaining payable balance';
  end if;

  insert into public.vendor_payments(
    organization_id,branch_id,actor_user_id,service_principal,operation_scope,
    vendor_id,payment_date,amount,payment_method,reference,notes
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),p_operation_scope,
    p_vendor_id,coalesce(p_payment_date,current_date),p_amount,p_payment_method,
    nullif(btrim(p_reference),''),nullif(btrim(p_notes),'')
  ) returning id into v_payment_id;

  insert into public.vendor_payment_allocations(
    organization_id,branch_id,payment_id,purchase_id,amount
  )
  select p_organization_id,p_branch_id,v_payment_id,item.purchase_id,item.amount
  from jsonb_to_recordset(p_allocations) as item(purchase_id bigint,amount numeric);

  insert into public.vendor_payable_ledger_entries(
    organization_id,branch_id,vendor_id,entry_type,reference_type,reference_id,
    debit,credit,entry_date,description
  ) values (
    p_organization_id,p_branch_id,p_vendor_id,'PAYMENT','VENDOR_PAYMENT',v_payment_id,
    p_amount,0,coalesce(p_payment_date,current_date),'Vendor payment against payable'
  );

  insert into public.journal_entries(
    organization_id,branch_id,actor_user_id,entry_date,description,source_type,
    source_id,source_record_id,posting_kind,principal_scope,operation_scope,
    idempotency_key,request_fingerprint,status
  ) values (
    p_organization_id,p_branch_id,p_actor_user_id,coalesce(p_payment_date,current_date),
    'Vendor payment '||v_payment_id,'VENDOR_PAYMENT',null,v_payment_id::text,'PRIMARY',
    btrim(p_service_principal),p_operation_scope,btrim(p_idempotency_key),
    p_request_fingerprint,'DRAFT'
  ) returning id into v_journal_entry_id;
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
    (v_journal_entry_id,v_payable_account,p_amount,0,'Reduce vendor accounts payable'),
    (v_journal_entry_id,v_funding_account,0,p_amount,'Vendor payment funding account');
  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries set status='POSTED' where id=v_journal_entry_id;

  update public.vendor_payment_idempotency_keys
  set payment_id=v_payment_id,journal_entry_id=v_journal_entry_id
  where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
    and operation=p_operation_scope and idempotency_key=btrim(p_idempotency_key);
  return v_payment_id;
end;
$$;

alter function public.record_purchase(uuid,uuid,uuid,text,text,bigint,bigint,jsonb,text,text,date,text,numeric,numeric,text) owner to postgres;
alter function public.record_customer_payment(uuid,uuid,uuid,text,text,bigint,date,numeric,text,text,text,text,jsonb,text,text) owner to postgres;
alter function public.record_sales_return(uuid,uuid,uuid,text,text,text,bigint,bigint,date,text,text,text,jsonb,text,text) owner to postgres;
alter function public.record_vendor_payment(uuid,uuid,uuid,text,text,bigint,numeric,text,jsonb,date,text,text,text,text) owner to postgres;

revoke all on function public.record_purchase(uuid,uuid,uuid,text,text,bigint,bigint,jsonb,text,text,date,text,numeric,numeric,text) from public, anon, authenticated;
revoke all on function public.record_customer_payment(uuid,uuid,uuid,text,text,bigint,date,numeric,text,text,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.record_sales_return(uuid,uuid,uuid,text,text,text,bigint,bigint,date,text,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.record_vendor_payment(uuid,uuid,uuid,text,text,bigint,numeric,text,jsonb,date,text,text,text,text) from public, anon, authenticated;

grant execute on function public.record_purchase(uuid,uuid,uuid,text,text,bigint,bigint,jsonb,text,text,date,text,numeric,numeric,text) to service_role;
grant execute on function public.record_customer_payment(uuid,uuid,uuid,text,text,bigint,date,numeric,text,text,text,text,jsonb,text,text) to service_role;
grant execute on function public.record_sales_return(uuid,uuid,uuid,text,text,text,bigint,bigint,date,text,text,text,jsonb,text,text) to service_role;
grant execute on function public.record_vendor_payment(uuid,uuid,uuid,text,text,bigint,numeric,text,jsonb,date,text,text,text,text) to service_role;

-- Disable every historical service-facing/non-sales writer. They are preserved
-- as history but may not bypass the new authoritative context boundary.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.record_purchase(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)',
    'public.record_customer_payment(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text)',
    'public.record_sales_return(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text)',
    'public.record_vendor_payment(bigint,numeric,text,jsonb,date,text,text,text,text,text)',
    'public.record_purchase_p0_6_impl(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)',
    'public.record_customer_payment_p0_6_impl(bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text)',
    'public.record_sales_return_p0_6_impl(text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text)',
    'public.record_vendor_payment_p0_6_impl(bigint,numeric,text,jsonb,date,text,text,text,text,text)',
    'public.record_purchase_core(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)',
    'public.record_vendor_payment_core(bigint,numeric,text,jsonb,date,text,text,text,text,text)',
    'public.record_purchase_with_payable(bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text)',
    'public.record_vendor_payment_with_accounting(bigint,numeric,text,jsonb,date,text,text,text,text,text)'
  ]
  loop
    if to_regprocedure(v_signature) is not null then
      execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    end if;
  end loop;
end
$$;

-- Direct service-role DML cannot become an alternate mutation path. The new
-- postgres-owned SECURITY DEFINER functions retain the required table access.
revoke insert, update, delete, truncate on table
  public.purchases,
  public.purchase_items,
  public.purchase_idempotency_keys,
  public.customer_payments,
  public.customer_payment_allocations,
  public.customer_payment_idempotency_keys,
  public.credit_notes,
  public.credit_note_items,
  public.credit_note_idempotency_keys,
  public.vendor_payments,
  public.vendor_payment_allocations,
  public.vendor_payment_idempotency_keys,
  public.inventory,
  public.stock_movements,
  public.customer_ledger_entries,
  public.vendor_payable_ledger_entries
from service_role;

grant select on table
  public.purchases,
  public.purchase_items,
  public.purchase_idempotency_keys,
  public.customer_payments,
  public.customer_payment_allocations,
  public.customer_payment_idempotency_keys,
  public.credit_notes,
  public.credit_note_items,
  public.credit_note_idempotency_keys,
  public.vendor_payments,
  public.vendor_payment_allocations,
  public.vendor_payment_idempotency_keys,
  public.inventory,
  public.stock_movements,
  public.customer_ledger_entries,
  public.vendor_payable_ledger_entries
to service_role;

comment on function public.record_purchase(uuid,uuid,uuid,text,text,bigint,bigint,jsonb,text,text,date,text,numeric,numeric,text) is
  'P0 tenant/branch/actor-authorized atomic purchase, inventory, AP, and authoritative GL boundary.';
comment on function public.record_customer_payment(uuid,uuid,uuid,text,text,bigint,date,numeric,text,text,text,text,jsonb,text,text) is
  'P0 tenant/branch/actor-authorized atomic customer payment, AR, and authoritative GL boundary.';
comment on function public.record_sales_return(uuid,uuid,uuid,text,text,text,bigint,bigint,date,text,text,text,jsonb,text,text) is
  'P0 tenant/branch/actor-authorized atomic sales return, inventory, AR, and authoritative GL boundary.';
comment on function public.record_vendor_payment(uuid,uuid,uuid,text,text,bigint,numeric,text,jsonb,date,text,text,text,text) is
  'P0 tenant/branch/actor-authorized atomic vendor payment, AP, and authoritative GL boundary.';
