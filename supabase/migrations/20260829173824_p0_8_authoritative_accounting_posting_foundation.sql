-- STEP 6 P0-8: Authoritative Accounting Posting Foundation
-- Forward-only repository migration. Production application is explicitly out of scope.
-- Establishes the first authoritative sales posting path around
-- public.accounts -> public.journal_entries -> public.journal_lines.

-- Required accepted foundations. Fail closed rather than silently falling back to
-- historical Phase 21 or legacy sales/accounting paths.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.branches') is null
     or to_regclass('public.branch_access_grants') is null then
    raise exception 'P0-8 requires canonical organization and P0-4 branch foundations';
  end if;

  if to_regprocedure('public.is_organization_member_for_user(uuid,uuid)') is null
     or to_regprocedure('public.has_permission_for_user(uuid,uuid,text)') is null
     or to_regprocedure('public.has_branch_access_for_user(uuid,uuid,uuid)') is null then
    raise exception 'P0-8 requires P0-5 membership and branch access helpers';
  end if;

  if to_regprocedure('public.post_invoice_atomic(jsonb,jsonb,bigint,text,text)') is null then
    raise exception 'P0-8 requires the P0-6 service-principal invoice boundary';
  end if;

  if to_regclass('public.accounts') is null
     or to_regclass('public.journal_entries') is null
     or to_regclass('public.journal_lines') is null then
    raise exception 'P0-8 requires the authoritative accounting foundation';
  end if;
end
$$;

-- The accepted ownership gate found no authoritative journal or sales-idempotency
-- rows requiring backfill. If that changes before application, stop instead of
-- guessing organization ownership for financial history.
do $$
begin
  if exists (select 1 from public.journal_entries) then
    raise exception 'P0-8 requires empty authoritative journal_entries or a separately approved ownership reconciliation';
  end if;
  if exists (select 1 from public.sales_transaction_idempotency_keys) then
    raise exception 'P0-8 requires empty sales idempotency rows or a separately approved ownership reconciliation';
  end if;
end
$$;

-- Expand organization ownership only. Existing rows are intentionally NOT
-- backfilled. NULL means ownership is still unknown and the new P0-8 sales
-- boundary refuses to use that row.
alter table public.customers add column if not exists organization_id uuid;
alter table public.products add column if not exists organization_id uuid;
alter table public.warehouses add column if not exists organization_id uuid;
alter table public.inventory add column if not exists organization_id uuid;
alter table public.estimates add column if not exists organization_id uuid;
alter table public.salespeople add column if not exists organization_id uuid;

alter table public.customers
  add constraint customers_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.products
  add constraint products_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.warehouses
  add constraint warehouses_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.inventory
  add constraint inventory_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.estimates
  add constraint estimates_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;
alter table public.salespeople
  add constraint salespeople_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict;

create index if not exists customers_p0_8_organization_idx on public.customers(organization_id);
create index if not exists products_p0_8_organization_idx on public.products(organization_id);
create index if not exists warehouses_p0_8_organization_idx on public.warehouses(organization_id);
create index if not exists inventory_p0_8_organization_idx on public.inventory(organization_id, warehouse_id, product_id);
create index if not exists estimates_p0_8_organization_idx on public.estimates(organization_id);
create index if not exists salespeople_p0_8_organization_idx on public.salespeople(organization_id);

-- Organization/branch scope for the selected sales operational projections.
alter table public.invoices
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid;
alter table public.customer_ledger_entries
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid;
alter table public.stock_movements
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid;

alter table public.invoices
  add constraint invoices_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint invoices_p0_8_branch_organization_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint invoices_p0_8_branch_requires_org_check check (branch_id is null or organization_id is not null),
  add constraint invoices_p0_8_financial_scope_check check (status = 'DRAFT' or organization_id is not null);
alter table public.customer_ledger_entries
  add constraint customer_ledger_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint customer_ledger_p0_8_branch_organization_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint customer_ledger_p0_8_branch_requires_org_check check (branch_id is null or organization_id is not null);
alter table public.stock_movements
  add constraint stock_movements_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint stock_movements_p0_8_branch_organization_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint stock_movements_p0_8_branch_requires_org_check check (branch_id is null or organization_id is not null);

create index if not exists invoices_p0_8_organization_date_idx on public.invoices(organization_id, issue_date, id);
create index if not exists customer_ledger_p0_8_organization_date_idx on public.customer_ledger_entries(organization_id, entry_date, id);
create index if not exists stock_movements_p0_8_organization_idx on public.stock_movements(organization_id, warehouse_id, product_id, id);

-- Organization-scoped sales idempotency. Existing principal_id remains the named
-- P0-6 service-principal scope; actor_user_id is the P0-5 user authorization subject.
alter table public.sales_transaction_idempotency_keys
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists operation_scope text,
  add column if not exists journal_entry_id uuid;

alter table public.sales_transaction_idempotency_keys
  drop constraint if exists sales_transaction_idempotency_unique;

drop index if exists public.sales_transaction_idempotency_unique;

alter table public.sales_transaction_idempotency_keys
  alter column organization_id set not null,
  alter column actor_user_id set not null,
  alter column operation_scope set not null,
  alter column request_fingerprint set not null,
  add constraint sales_idempotency_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint sales_idempotency_p0_8_branch_organization_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint sales_idempotency_p0_8_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint sales_idempotency_p0_8_branch_requires_org_check check (branch_id is null or organization_id is not null),
  add constraint sales_idempotency_p0_8_operation_check check (btrim(operation_scope) <> ''),
  add constraint sales_idempotency_p0_8_fingerprint_check check (btrim(request_fingerprint) <> '');

create unique index sales_transaction_idempotency_p0_8_scope_key
  on public.sales_transaction_idempotency_keys(organization_id, principal_id, operation_scope, idempotency_key);

-- Authoritative journal metadata required by P0-7.
alter table public.journal_entries
  add column if not exists organization_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists source_record_id text,
  add column if not exists posting_kind text,
  add column if not exists principal_scope text,
  add column if not exists operation_scope text,
  add column if not exists request_fingerprint text,
  add column if not exists reversal_of_journal_entry_id uuid;

alter table public.journal_entries
  drop constraint if exists journal_entries_source_type_source_id_key,
  drop constraint if exists journal_entries_idempotency_key_key,
  drop constraint if exists journal_entries_status_check;

alter table public.journal_entries
  alter column organization_id set not null,
  alter column actor_user_id set not null,
  alter column source_record_id set not null,
  alter column posting_kind set not null,
  alter column principal_scope set not null,
  alter column operation_scope set not null,
  alter column idempotency_key set not null,
  alter column request_fingerprint set not null,
  add constraint journal_entries_status_check check (status in ('DRAFT','POSTED','VOIDED')),
  add constraint journal_entries_p0_8_organization_fkey foreign key (organization_id) references public.organizations(id) on delete restrict,
  add constraint journal_entries_p0_8_branch_organization_fkey foreign key (organization_id, branch_id) references public.branches(organization_id, id) on delete restrict,
  add constraint journal_entries_p0_8_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  add constraint journal_entries_p0_8_reversal_fkey foreign key (reversal_of_journal_entry_id) references public.journal_entries(id) on delete restrict,
  add constraint journal_entries_p0_8_branch_requires_org_check check (branch_id is null or organization_id is not null),
  add constraint journal_entries_p0_8_source_record_check check (btrim(source_record_id) <> ''),
  add constraint journal_entries_p0_8_posting_kind_check check (btrim(posting_kind) <> ''),
  add constraint journal_entries_p0_8_principal_scope_check check (btrim(principal_scope) <> ''),
  add constraint journal_entries_p0_8_operation_scope_check check (btrim(operation_scope) <> ''),
  add constraint journal_entries_p0_8_idempotency_key_check check (btrim(idempotency_key) <> ''),
  add constraint journal_entries_p0_8_fingerprint_check check (btrim(request_fingerprint) <> '');

create unique index journal_entries_p0_8_source_key
  on public.journal_entries(organization_id, source_type, source_record_id, posting_kind);
create unique index journal_entries_p0_8_idempotency_key
  on public.journal_entries(organization_id, principal_scope, operation_scope, idempotency_key);
create index journal_entries_p0_8_organization_date_idx
  on public.journal_entries(organization_id, entry_date, id);

alter table public.sales_transaction_idempotency_keys
  add constraint sales_idempotency_p0_8_journal_fkey foreign key (journal_entry_id) references public.journal_entries(id) on delete restrict;

-- Rent is a liability, not revenue and not a second receivable debit.
insert into public.accounts(code, name, account_type, normal_balance)
values ('2100', 'Rent Payable', 'LIABILITY', 'CREDIT')
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.accounts where code='1100' and account_type='ASSET' and normal_balance='DEBIT' and is_active)
     or not exists (select 1 from public.accounts where code='1200' and account_type='ASSET' and normal_balance='DEBIT' and is_active)
     or not exists (select 1 from public.accounts where code='2100' and account_type='LIABILITY' and normal_balance='CREDIT' and is_active)
     or not exists (select 1 from public.accounts where code='4000' and account_type='REVENUE' and normal_balance='CREDIT' and is_active)
     or not exists (select 1 from public.accounts where code='5000' and account_type='EXPENSE' and normal_balance='DEBIT' and is_active) then
    raise exception 'P0-8 authoritative chart of accounts is missing or incompatible';
  end if;
end
$$;

-- Strengthen the authoritative journal assertion. The assertion is independent
-- of entry status so it can validate a DRAFT immediately before the controlled
-- DRAFT -> POSTED transition.
create or replace function public.assert_journal_entry_balanced(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line_count bigint;
  v_debit numeric(20,4);
  v_credit numeric(20,4);
begin
  select count(*), coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0)
    into v_line_count, v_debit, v_credit
  from public.journal_lines jl
  where jl.journal_entry_id = p_entry_id;

  if v_line_count < 2 then
    raise exception using errcode='23514', message='posted journal requires at least two lines';
  end if;
  if v_debit <= 0 then
    raise exception using errcode='23514', message='posted journal total debit must be greater than zero';
  end if;
  if v_debit <> v_credit then
    raise exception using errcode='23514', message='posted journal total debits must equal total credits';
  end if;
end;
$$;

-- Posted journal entries and inserted journal lines are immutable. Lines may be
-- inserted only while their parent is DRAFT; P0-8 never updates/deletes lines.
create or replace function private.enforce_authoritative_journal_entry_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode='23514', message='authoritative journal entries cannot be deleted; use a reversal';
  end if;

  if old.status <> 'DRAFT' then
    raise exception using errcode='23514', message='posted journal entries are immutable; use a reversal';
  end if;

  if new.status <> 'POSTED' then
    raise exception using errcode='23514', message='journal status transition must be DRAFT to POSTED';
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.branch_id is distinct from old.branch_id
     or new.actor_user_id is distinct from old.actor_user_id
     or new.entry_date is distinct from old.entry_date
     or new.description is distinct from old.description
     or new.source_type is distinct from old.source_type
     or new.source_id is distinct from old.source_id
     or new.source_record_id is distinct from old.source_record_id
     or new.posting_kind is distinct from old.posting_kind
     or new.principal_scope is distinct from old.principal_scope
     or new.operation_scope is distinct from old.operation_scope
     or new.idempotency_key is distinct from old.idempotency_key
     or new.request_fingerprint is distinct from old.request_fingerprint
     or new.reversal_of_journal_entry_id is distinct from old.reversal_of_journal_entry_id then
    raise exception using errcode='23514', message='journal identity cannot change while posting';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_authoritative_journal_line_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode='23514', message='authoritative journal lines are immutable after insert';
  end if;

  select je.status into v_status
  from public.journal_entries je
  where je.id = new.journal_entry_id;

  if v_status is distinct from 'DRAFT' then
    raise exception using errcode='23514', message='journal lines may be inserted only while the entry is DRAFT';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_authoritative_journal_balance_at_post()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'POSTED' then
    perform public.assert_journal_entry_balanced(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists journal_entries_p0_8_lifecycle_guard on public.journal_entries;
create trigger journal_entries_p0_8_lifecycle_guard
before update or delete on public.journal_entries
for each row execute function private.enforce_authoritative_journal_entry_lifecycle();

drop trigger if exists journal_lines_p0_8_lifecycle_guard on public.journal_lines;
create trigger journal_lines_p0_8_lifecycle_guard
before insert or update or delete on public.journal_lines
for each row execute function private.enforce_authoritative_journal_line_lifecycle();

drop trigger if exists journal_entries_p0_8_balance_guard on public.journal_entries;
create constraint trigger journal_entries_p0_8_balance_guard
after insert or update on public.journal_entries
deferrable initially deferred
for each row execute function private.enforce_authoritative_journal_balance_at_post();

-- Direct Data API roles remain denied. service_role can read the authoritative
-- model but cannot bypass the posting function with direct journal DML.
alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_lines from anon, authenticated;
revoke insert, update, delete, truncate on table public.journal_entries, public.journal_lines from service_role;
grant select on table public.accounts, public.journal_entries, public.journal_lines to service_role;

revoke all on function public.assert_journal_entry_balanced(uuid) from public, anon, authenticated, service_role;
revoke all on function private.enforce_authoritative_journal_entry_lifecycle() from public, anon, authenticated, service_role;
revoke all on function private.enforce_authoritative_journal_line_lifecycle() from public, anon, authenticated, service_role;
revoke all on function private.enforce_authoritative_journal_balance_at_post() from public, anon, authenticated, service_role;

-- The old generic journal writer is no longer an authoritative service entry point.
revoke all on function public.post_journal_entry(date, text, text, uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Disable the P0-6 five-argument wrapper because it delegates to the legacy
-- accounting_journal_* implementation. The private P0-6 implementation remains
-- preserved but unreachable to service/browser roles.
revoke all on function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text) from public, anon, authenticated, service_role;

-- Older repository history may contain record_sales_transaction even though the
-- targeted live database path does not. Disable it if present; do not require it.
do $$
begin
  if to_regprocedure('public.record_sales_transaction(text,text,text,text,bigint,bigint,text,date,text,numeric,numeric,numeric,numeric,text,bigint,jsonb)') is not null then
    execute 'revoke all on function public.record_sales_transaction(text,text,text,text,bigint,bigint,text,date,text,numeric,numeric,numeric,numeric,text,bigint,jsonb) from public, anon, authenticated, service_role';
  end if;
end
$$;

-- P0-8 authoritative sales posting boundary. One RPC call creates the POSTED
-- invoice, inventory movement/current-state decrement, AR subledger projection,
-- authoritative GL journal, event, and idempotency/source link atomically.
create function public.post_invoice_atomic(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb,
  p_lines jsonb,
  p_warehouse_id bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invoice_id bigint;
  v_journal_entry_id uuid;
  v_existing_invoice_id bigint;
  v_existing_journal_entry_id uuid;
  v_existing_fingerprint text;
  v_existing_actor uuid;
  v_existing_branch uuid;
  v_item jsonb;
  v_inventory_request record;
  v_product_id bigint;
  v_quantity numeric;
  v_unit text;
  v_unit_price numeric;
  v_line_total numeric;
  v_unit_cost numeric;
  v_cogs_total numeric;
  v_stock numeric;
  v_line_sum numeric := 0;
  v_cogs numeric := 0;
  v_subtotal numeric := coalesce((p_invoice->>'subtotal')::numeric, 0);
  v_discount numeric := coalesce((p_invoice->>'discount_total')::numeric, 0);
  v_rent numeric := coalesce((p_invoice->>'pass_through_rent')::numeric, 0);
  v_grand_total numeric := coalesce((p_invoice->>'grand_total')::numeric, 0);
  v_revenue numeric;
  v_invoice_number text := btrim(coalesce(p_invoice->>'invoice_number', ''));
  v_customer_id bigint := nullif(p_invoice->>'customer_id', '')::bigint;
  v_salesperson_id bigint := nullif(p_invoice->>'salesperson_id', '')::bigint;
  v_source_estimate_id bigint := nullif(p_invoice->>'source_estimate_id', '')::bigint;
  v_source_type text := coalesce(p_invoice->>'source_type', 'DIRECT');
  v_issue_date date := coalesce((p_invoice->>'issue_date')::date, current_date);
  v_currency_code text := upper(btrim(coalesce(p_invoice->>'currency_code', 'PKR')));
  v_ar_account uuid;
  v_inventory_account uuid;
  v_rent_payable_account uuid;
  v_sales_account uuid;
  v_cogs_account uuid;
begin
  if p_organization_id is null or p_actor_user_id is null then
    raise exception using errcode='42501', message='organization_id and actor_user_id are required';
  end if;
  if nullif(btrim(p_service_principal), '') is null
     or lower(btrim(p_service_principal)) in ('backend','default','internal-system','service-role','service_role','system') then
    raise exception using errcode='42501', message='Explicit service principal is required';
  end if;
  if p_operation_scope is distinct from 'sales.invoice.post' then
    raise exception using errcode='42501', message='Service principal operation is not authorized for invoice posting';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 255 then
    raise exception using errcode='22023', message='A valid idempotency key is required';
  end if;
  if nullif(btrim(p_request_fingerprint), '') is null then
    raise exception using errcode='22023', message='request_fingerprint is required';
  end if;

  if not public.is_organization_member_for_user(p_actor_user_id, p_organization_id) then
    raise exception using errcode='42501', message='Active organization membership is required';
  end if;
  if not public.has_permission_for_user(p_actor_user_id, p_organization_id, 'sales.create') then
    raise exception using errcode='42501', message='sales.create permission is required';
  end if;
  if not public.has_permission_for_user(p_actor_user_id, p_organization_id, 'accounting.post') then
    raise exception using errcode='42501', message='accounting.post permission is required';
  end if;
  if p_branch_id is not null
     and not public.has_branch_access_for_user(p_actor_user_id, p_organization_id, p_branch_id) then
    raise exception using errcode='42501', message='Explicit branch access is required';
  end if;

  if v_invoice_number = '' then
    raise exception using errcode='22023', message='invoice_number is required';
  end if;
  if v_currency_code = '' then
    raise exception using errcode='22023', message='currency_code is required';
  end if;
  if v_customer_id is null or v_customer_id <= 0 or p_warehouse_id is null or p_warehouse_id <= 0 then
    raise exception using errcode='22023', message='customer_id and warehouse_id must be positive';
  end if;
  if v_source_type not in ('DIRECT','FROM_ESTIMATE') then
    raise exception using errcode='22023', message='invalid source_type';
  end if;
  if v_source_type = 'DIRECT' and v_source_estimate_id is not null then
    raise exception using errcode='22023', message='DIRECT invoice cannot have source_estimate_id';
  end if;
  if v_source_type = 'FROM_ESTIMATE' and v_source_estimate_id is null then
    raise exception using errcode='22023', message='source_estimate_id is required';
  end if;
  if v_subtotal < 0 or v_discount < 0 or v_rent < 0 or v_grand_total <= 0 then
    raise exception using errcode='22023', message='invoice totals are invalid';
  end if;
  if v_discount > v_subtotal then
    raise exception using errcode='22023', message='discount_total cannot exceed subtotal';
  end if;
  if v_grand_total <> v_subtotal - v_discount + v_rent then
    raise exception using errcode='23514', message='grand_total must equal subtotal minus discount plus pass-through rent';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode='22023', message='invoice must contain at least one line';
  end if;

  -- Fail closed on unknown/unassigned master-data ownership. P0-8 never guesses
  -- organization ownership for pre-existing rows.
  if not exists (select 1 from public.customers c where c.id = v_customer_id and c.organization_id = p_organization_id) then
    raise exception using errcode='42501', message='customer ownership is not assigned to the authorized organization';
  end if;
  if not exists (select 1 from public.warehouses w where w.id = p_warehouse_id and w.organization_id = p_organization_id) then
    raise exception using errcode='42501', message='warehouse ownership is not assigned to the authorized organization';
  end if;
  if v_salesperson_id is not null
     and not exists (select 1 from public.salespeople s where s.id = v_salesperson_id and s.organization_id = p_organization_id and s.active) then
    raise exception using errcode='42501', message='salesperson ownership is not assigned to the authorized organization';
  end if;

  if v_source_type = 'FROM_ESTIMATE' then
    perform 1
    from public.estimates e
    where e.id = v_source_estimate_id
      and e.organization_id = p_organization_id
    for update;
    if not found then
      raise exception using errcode='42501', message='estimate ownership is not assigned to the authorized organization';
    end if;
    if (select e.status from public.estimates e where e.id = v_source_estimate_id) <> 'READY' then
      raise exception using errcode='22023', message='source estimate must be READY';
    end if;
  end if;

  if (select count(*) from jsonb_array_elements(p_lines)) <>
     (select count(distinct (value->>'line_number')::integer) from jsonb_array_elements(p_lines)) then
    raise exception using errcode='23514', message='invoice line_number values must be unique';
  end if;

  -- Acquire a scoped idempotency row first. A concurrent retry with the same
  -- scope serializes here and can only reuse the same fingerprint/context.
  insert into public.sales_transaction_idempotency_keys(
    organization_id, branch_id, actor_user_id, principal_id, operation_scope,
    idempotency_key, request_fingerprint
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, p_idempotency_key, p_request_fingerprint
  )
  on conflict (organization_id, principal_id, operation_scope, idempotency_key) do nothing;

  select k.invoice_id, k.journal_entry_id, k.request_fingerprint, k.actor_user_id, k.branch_id
    into v_existing_invoice_id, v_existing_journal_entry_id, v_existing_fingerprint, v_existing_actor, v_existing_branch
  from public.sales_transaction_idempotency_keys k
  where k.organization_id = p_organization_id
    and k.principal_id = p_service_principal
    and k.operation_scope = p_operation_scope
    and k.idempotency_key = p_idempotency_key
  for update;

  if v_existing_fingerprint is distinct from p_request_fingerprint
     or v_existing_actor is distinct from p_actor_user_id
     or v_existing_branch is distinct from p_branch_id then
    raise exception using errcode='P0001', message='idempotency key was already used for a different sales request';
  end if;

  if v_existing_invoice_id is not null then
    if v_existing_journal_entry_id is null
       or not exists (
         select 1 from public.journal_entries je
         where je.id = v_existing_journal_entry_id
           and je.organization_id = p_organization_id
           and je.source_type = 'INVOICE'
           and je.source_record_id = v_existing_invoice_id::text
           and je.posting_kind = 'PRIMARY'
           and je.status = 'POSTED'
       ) then
      raise exception using errcode='23514', message='idempotent invoice replay is missing its authoritative posted journal';
    end if;

    select coalesce(sum(ii.cogs_total), 0) into v_cogs
    from public.invoice_items ii
    where ii.invoice_id = v_existing_invoice_id;
    select i.grand_total - i.pass_through_rent, i.pass_through_rent
      into v_revenue, v_rent
    from public.invoices i
    where i.id = v_existing_invoice_id and i.organization_id = p_organization_id;

    return jsonb_build_object(
      'invoice_id', v_existing_invoice_id,
      'journal_entry_id', v_existing_journal_entry_id,
      'replayed', true,
      'revenue', v_revenue,
      'cogs', v_cogs,
      'rent', v_rent,
      'profit', v_revenue - v_cogs
    );
  end if;

  -- Validate all lines and lock inventory in deterministic product/line order.
  for v_item in
    select value
    from jsonb_array_elements(p_lines)
    order by (value->>'product_id')::bigint, (value->>'line_number')::integer
  loop
    v_product_id := nullif(v_item->>'product_id', '')::bigint;
    v_quantity := nullif(v_item->>'quantity', '')::numeric;
    v_unit := btrim(coalesce(v_item->>'unit', ''));
    v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
    v_line_total := nullif(v_item->>'line_total', '')::numeric;
    v_unit_cost := nullif(v_item->>'unit_cost', '')::numeric;
    v_cogs_total := nullif(v_item->>'cogs_total', '')::numeric;

    if v_product_id is null or v_product_id <= 0 or v_quantity is null or v_quantity <= 0
       or v_unit = '' or v_unit_price is null or v_unit_price < 0 or v_line_total is null or v_line_total < 0 then
      raise exception using errcode='22023', message='invalid invoice line';
    end if;
    if v_line_total <> v_quantity * v_unit_price then
      raise exception using errcode='23514', message='invoice line_total does not equal quantity multiplied by unit_price';
    end if;
    if v_unit_cost is null or v_unit_cost < 0 or v_cogs_total is null or v_cogs_total <> v_quantity * v_unit_cost then
      raise exception using errcode='23514', message='explicit posted unit_cost and cogs_total are required; P0-8 does not invent a costing method';
    end if;
    if not exists (select 1 from public.products p where p.id = v_product_id and p.organization_id = p_organization_id) then
      raise exception using errcode='42501', message='product ownership is not assigned to the authorized organization';
    end if;

    v_line_sum := v_line_sum + v_line_total;
    v_cogs := v_cogs + v_cogs_total;
  end loop;

  if v_line_sum <> v_subtotal then
    raise exception using errcode='23514', message='subtotal does not equal invoice line totals';
  end if;

  -- Lock/check each inventory row once using the total requested quantity for
  -- that product. This prevents repeated product lines from bypassing the
  -- insufficient-stock guard.
  for v_inventory_request in
    select
      (value->>'product_id')::bigint as product_id,
      sum((value->>'quantity')::numeric) as quantity
    from jsonb_array_elements(p_lines)
    group by (value->>'product_id')::bigint
    order by (value->>'product_id')::bigint
  loop
    select i.quantity into v_stock
    from public.inventory i
    where i.product_id = v_inventory_request.product_id
      and i.warehouse_id = p_warehouse_id
      and i.organization_id = p_organization_id
    for update;

    if not found then
      raise exception using errcode='42501', message='inventory ownership is not assigned to the authorized organization';
    end if;
    if v_stock < v_inventory_request.quantity then
      raise exception using errcode='P0004', message='insufficient stock';
    end if;
  end loop;

  v_revenue := v_subtotal - v_discount;

  select a.id into v_ar_account from public.accounts a where a.code='1100' and a.is_active;
  select a.id into v_inventory_account from public.accounts a where a.code='1200' and a.is_active;
  select a.id into v_rent_payable_account from public.accounts a where a.code='2100' and a.is_active;
  select a.id into v_sales_account from public.accounts a where a.code='4000' and a.is_active;
  select a.id into v_cogs_account from public.accounts a where a.code='5000' and a.is_active;
  if v_ar_account is null or v_inventory_account is null or v_rent_payable_account is null
     or v_sales_account is null or v_cogs_account is null then
    raise exception using errcode='23503', message='authoritative chart of accounts is incomplete for invoice posting';
  end if;

  insert into public.invoices(
    organization_id, branch_id, invoice_number, customer_id, source_estimate_id,
    source_type, issue_date, currency_code, status, subtotal, discount_total,
    grand_total, pass_through_rent, salesperson_id, warehouse_id, notes
  ) values (
    p_organization_id, p_branch_id, v_invoice_number, v_customer_id,
    v_source_estimate_id, v_source_type, v_issue_date, v_currency_code, 'POSTED',
    v_subtotal, v_discount, v_grand_total, v_rent, v_salesperson_id,
    p_warehouse_id, p_invoice->>'notes'
  ) returning id into v_invoice_id;

  for v_item in
    select value
    from jsonb_array_elements(p_lines)
    order by (value->>'line_number')::integer
  loop
    v_product_id := (v_item->>'product_id')::bigint;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := btrim(v_item->>'unit');
    v_unit_price := (v_item->>'unit_price')::numeric;
    v_line_total := (v_item->>'line_total')::numeric;
    v_unit_cost := (v_item->>'unit_cost')::numeric;
    v_cogs_total := (v_item->>'cogs_total')::numeric;

    insert into public.invoice_items(
      invoice_id, line_number, product_id, quantity, unit, unit_price,
      line_total, unit_cost, cogs_total, pricing_source
    ) values (
      v_invoice_id, (v_item->>'line_number')::integer, v_product_id,
      v_quantity, v_unit, v_unit_price, v_line_total, v_unit_cost,
      v_cogs_total, coalesce(v_item->>'pricing_source', 'MANUAL_OVERRIDE')
    );

    update public.inventory
    set quantity = quantity - v_quantity,
        updated_at = now()
    where product_id = v_product_id
      and warehouse_id = p_warehouse_id
      and organization_id = p_organization_id;
    if not found then
      raise exception using errcode='23514', message='inventory row disappeared during authoritative posting';
    end if;

    insert into public.stock_movements(
      organization_id, branch_id, product_id, warehouse_id, movement_type,
      quantity, reference_type, reference_id, unit_cost, notes
    ) values (
      p_organization_id, p_branch_id, v_product_id, p_warehouse_id, 'SALE',
      v_quantity, 'INVOICE', v_invoice_id, v_unit_cost, v_invoice_number
    );
  end loop;

  insert into public.customer_ledger_entries(
    organization_id, branch_id, customer_id, entry_type, reference_type,
    reference_id, debit, credit, currency_code, entry_date, description
  ) values (
    p_organization_id, p_branch_id, v_customer_id, 'INVOICE', 'INVOICE',
    v_invoice_id, v_grand_total, 0, v_currency_code, v_issue_date, v_invoice_number
  );

  insert into public.journal_entries(
    organization_id, branch_id, actor_user_id, entry_date, description,
    source_type, source_id, source_record_id, posting_kind, principal_scope,
    operation_scope, idempotency_key, request_fingerprint, status
  ) values (
    p_organization_id, p_branch_id, p_actor_user_id, v_issue_date,
    'Invoice ' || v_invoice_number, 'INVOICE', null, v_invoice_id::text,
    'PRIMARY', p_service_principal, p_operation_scope, p_idempotency_key,
    p_request_fingerprint, 'DRAFT'
  ) returning id into v_journal_entry_id;

  insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
  values (v_journal_entry_id, v_ar_account, v_grand_total, 0, 'Customer receivable');

  if v_revenue > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (v_journal_entry_id, v_sales_account, 0, v_revenue, 'Product sales revenue');
  end if;

  if v_cogs > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo) values
      (v_journal_entry_id, v_cogs_account, v_cogs, 0, 'Cost of goods sold'),
      (v_journal_entry_id, v_inventory_account, 0, v_cogs, 'Inventory reduction');
  end if;

  if v_rent > 0 then
    insert into public.journal_lines(journal_entry_id, account_id, debit, credit, memo)
    values (v_journal_entry_id, v_rent_payable_account, 0, v_rent, 'Pass-through rent payable');
  end if;

  perform public.assert_journal_entry_balanced(v_journal_entry_id);
  update public.journal_entries
  set status = 'POSTED'
  where id = v_journal_entry_id;

  if v_source_type = 'FROM_ESTIMATE' then
    update public.estimates
    set status = 'CONVERTED', updated_at = now()
    where id = v_source_estimate_id
      and organization_id = p_organization_id;
  end if;

  insert into public.invoice_transaction_events(invoice_id, event_type, principal_id)
  values (v_invoice_id, 'POSTED', p_service_principal);

  update public.sales_transaction_idempotency_keys
  set invoice_id = v_invoice_id,
      journal_entry_id = v_journal_entry_id
  where organization_id = p_organization_id
    and principal_id = p_service_principal
    and operation_scope = p_operation_scope
    and idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'journal_entry_id', v_journal_entry_id,
    'replayed', false,
    'revenue', v_revenue,
    'cogs', v_cogs,
    'rent', v_rent,
    'profit', v_revenue - v_cogs
  );
exception
  when unique_violation then
    raise exception using errcode='23505', message='duplicate invoice, idempotency scope, or authoritative source posting';
end;
$$;

alter function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) owner to postgres;
revoke all on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) to service_role;

comment on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) is
  'P0-8 service_role-only authoritative invoice posting boundary. Requires P0-5 user/org permissions, optional explicit branch access, named P0-6 service principal, scoped idempotency, and balanced authoritative GL posting.';

-- Reporting remains exclusively on the authoritative GL and is now organization-aware.
create or replace view public.general_ledger
with (security_invoker = true)
as
select
  je.id as journal_entry_id,
  je.entry_date,
  je.description,
  je.source_type,
  je.source_id,
  a.id as account_id,
  a.code,
  a.name,
  jl.debit,
  jl.credit,
  jl.memo,
  je.organization_id,
  je.branch_id,
  je.source_record_id,
  je.posting_kind
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.accounts a on a.id = jl.account_id
where je.status = 'POSTED';

create or replace view public.trial_balance
with (security_invoker = true)
as
select
  a.id as account_id,
  a.code,
  a.name,
  a.account_type,
  a.normal_balance,
  coalesce(sum(jl.debit),0)::numeric(20,4) as total_debit,
  coalesce(sum(jl.credit),0)::numeric(20,4) as total_credit,
  (coalesce(sum(jl.debit),0) - coalesce(sum(jl.credit),0))::numeric(20,4) as net_balance,
  je.organization_id
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id
join public.accounts a on a.id = jl.account_id
where je.status = 'POSTED'
group by a.id, a.code, a.name, a.account_type, a.normal_balance, je.organization_id;

revoke all on public.general_ledger from anon, authenticated;
revoke all on public.trial_balance from anon, authenticated;
grant select on public.general_ledger, public.trial_balance to service_role;
