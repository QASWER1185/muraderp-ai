-- Reconcile estimate layout and pricing-selection objects that were present only
-- in the archived pre-canonical development migrations. The live ledger contains
-- the estimate tables but not these additive effects; keep this forward-only and
-- avoid introducing the non-canonical quotation schema.

create table if not exists public.estimate_layout_preferences (
  id bigint generated always as identity primary key,
  layout_key text not null check (layout_key in (
    'CLASSIC_PAKISTAN',
    'MODERN_PAKISTAN',
    'COMPACT_TRADE',
    'DETAILED_COMMERCIAL',
    'MINIMAL_CLEAN'
  )),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  is_system_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimate_layout_preferences_key_unique unique (layout_key)
);

insert into public.estimate_layout_preferences (layout_key, name, description)
values
  ('CLASSIC_PAKISTAN', 'Classic Pakistan', 'Traditional local-market estimate layout.'),
  ('MODERN_PAKISTAN', 'Modern Pakistan', 'Modern branded estimate layout.'),
  ('COMPACT_TRADE', 'Compact Trade', 'Compact trade-counter estimate layout.'),
  ('DETAILED_COMMERCIAL', 'Detailed Commercial', 'Detailed commercial estimate layout.'),
  ('MINIMAL_CLEAN', 'Minimal Clean', 'Minimal clean estimate layout.')
on conflict (layout_key) do nothing;

alter table public.estimate_layout_preferences enable row level security;
alter table public.estimate_layout_preferences force row level security;
drop policy if exists backend_only on public.estimate_layout_preferences;
create policy backend_only on public.estimate_layout_preferences
  for all to anon, authenticated
  using (false) with check (false);

revoke all on table public.estimate_layout_preferences from anon, authenticated;
grant select, insert, update, delete on table public.estimate_layout_preferences to service_role;
grant usage, select on sequence public.estimate_layout_preferences_id_seq to service_role;

alter table public.estimate_items
  add column if not exists rate_list_selection_source text not null default 'INHERITED'
    check (rate_list_selection_source in ('INHERITED', 'LINE_OVERRIDE', 'AI_SUGGESTED', 'MANUAL'));

alter table public.estimate_items
  add column if not exists brand_hint text;

alter table public.estimate_items
  add column if not exists manual_unit_price numeric;

alter table public.estimate_items
  drop constraint if exists estimate_items_manual_price_check;

alter table public.estimate_items
  add constraint estimate_items_manual_price_check
    check (manual_unit_price is null or manual_unit_price >= 0);
