-- Pricing selection rules for Estimate/Quotation.
-- 1) Estimate default rate list applies to all eligible lines.
-- 2) A line may override the default with its own rate list.
-- 3) A line may explicitly use a manual price, bypassing rate lists.
-- AI/OCR may suggest selections; explicit user selection remains authoritative.

alter table public.estimates
  add column if not exists default_rate_list_id bigint references public.rate_lists (id);

create index if not exists estimates_default_rate_list_idx
  on public.estimates (default_rate_list_id);

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

create index if not exists estimate_items_rate_list_idx
  on public.estimate_items (rate_list_id);
