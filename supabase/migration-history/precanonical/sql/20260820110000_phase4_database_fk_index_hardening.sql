-- Phase 4 database production-readiness performance hardening.
-- Add covering indexes for foreign keys identified by Supabase performance advisor.

create index if not exists accounts_parent_account_id_idx on public.accounts(parent_account_id);
create index if not exists ai_copilot_actions_user_id_idx on public.ai_copilot_actions(user_id);
create index if not exists credit_note_idempotency_keys_credit_note_id_idx on public.credit_note_idempotency_keys(credit_note_id);
create index if not exists credit_note_items_warehouse_id_idx on public.credit_note_items(warehouse_id);
create index if not exists customer_payment_idempotency_keys_payment_id_idx on public.customer_payment_idempotency_keys(payment_id);
create index if not exists estimate_items_product_id_idx on public.estimate_items(product_id);
create index if not exists estimate_items_rate_list_id_idx on public.estimate_items(rate_list_id);
create index if not exists estimate_items_rate_list_version_id_idx on public.estimate_items(rate_list_version_id);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships(user_id);
create index if not exists rate_lists_customer_id_idx on public.rate_lists(customer_id);
create index if not exists rate_lists_vendor_id_idx on public.rate_lists(vendor_id);
create index if not exists role_permissions_permission_code_idx on public.role_permissions(permission_code);
create index if not exists vendor_payment_idempotency_keys_payment_id_idx on public.vendor_payment_idempotency_keys(payment_id);
