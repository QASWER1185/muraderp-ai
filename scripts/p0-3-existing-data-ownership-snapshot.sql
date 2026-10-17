-- STEP 6 P0-3 read-only existing-data ownership snapshot.
-- This file MUST remain SELECT-only. It is evidence collection, not migration SQL.

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and column_name in ('organization_id', 'org_id', 'branch_id', 'user_id', 'created_by', 'updated_by')
order by table_name, ordinal_position;

select relname as table_name, n_live_tup::bigint as estimated_rows
from pg_stat_user_tables
where schemaname = 'public' and n_live_tup > 0
order by relname;

select jsonb_build_object(
  'auth_users', (select count(*) from auth.users),
  'organizations', (select count(*) from public.organizations),
  'organization_memberships', (select count(*) from public.organization_memberships),
  'customers', (select count(*) from public.customers),
  'vendors', (select count(*) from public.vendors),
  'products', (select count(*) from public.products),
  'warehouses', (select count(*) from public.warehouses),
  'inventory', (select count(*) from public.inventory),
  'stock_movements', (select count(*) from public.stock_movements),
  'purchases', (select count(*) from public.purchases),
  'purchase_items', (select count(*) from public.purchase_items),
  'invoices', (select count(*) from public.invoices),
  'invoice_items', (select count(*) from public.invoice_items),
  'customer_payments', (select count(*) from public.customer_payments),
  'vendor_payments', (select count(*) from public.vendor_payments),
  'journal_entries', (select count(*) from public.journal_entries),
  'accounts', (select count(*) from public.accounts),
  'permissions', (select count(*) from public.permissions),
  'role_permissions', (select count(*) from public.role_permissions),
  'ai_copilot_actions', (select count(*) from public.ai_copilot_actions)
) as ownership_counts;
