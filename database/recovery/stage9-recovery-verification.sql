-- MuradERP-AI Phase 23 / Stage 9
-- Read-only recovery verification queries.
-- Run only against an isolated restored database or a non-destructive verification target.

-- 1. Migration ledger baseline.
select count(*) as applied_migration_count
from supabase_migrations.schema_migrations;

-- 2. Critical ERP/accounting relations.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'accounts',
    'journal_entries',
    'journal_lines',
    'general_ledger',
    'trial_balance',
    'vendors',
    'purchases',
    'purchase_items',
    'invoices',
    'customer_payments',
    'vendor_payments',
    'inventory'
  )
order by table_name;

-- 3. RLS state for critical financial relations.
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'accounts',
    'journal_entries',
    'journal_lines',
    'general_ledger',
    'trial_balance',
    'purchases',
    'purchase_items',
    'invoices',
    'customer_payments',
    'vendor_payments'
  )
order by tablename;

-- 4. Table row counts for a known-good/reference dataset comparison.
select 'accounts' as table_name, count(*) as row_count from public.accounts
union all select 'journal_entries', count(*) from public.journal_entries
union all select 'journal_lines', count(*) from public.journal_lines
union all select 'purchases', count(*) from public.purchases
union all select 'purchase_items', count(*) from public.purchase_items
union all select 'invoices', count(*) from public.invoices
union all select 'customer_payments', count(*) from public.customer_payments
union all select 'vendor_payments', count(*) from public.vendor_payments
union all select 'inventory', count(*) from public.inventory
order by table_name;
