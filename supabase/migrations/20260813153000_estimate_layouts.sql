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

alter table public.estimates
  add column if not exists layout_key text not null default 'CLASSIC_PAKISTAN'
  check (layout_key in (
    'CLASSIC_PAKISTAN',
    'MODERN_PAKISTAN',
    'COMPACT_TRADE',
    'DETAILED_COMMERCIAL',
    'MINIMAL_CLEAN'
  ));

create index if not exists estimates_layout_key_idx
  on public.estimates (layout_key);
