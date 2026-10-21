-- Estimate-level default rate list supports a whole-estimate company choice.
-- estimate_items.rate_list_id remains the per-line override for mixed-brand estimates.

alter table public.estimates
  add column if not exists default_rate_list_id bigint references public.rate_lists (id);

create index if not exists estimates_default_rate_list_idx
  on public.estimates (default_rate_list_id);

comment on column public.estimates.default_rate_list_id is
  'Default sale rate list for the estimate; estimate_items.rate_list_id overrides it per line.';

comment on column public.estimate_items.rate_list_id is
  'Optional per-line rate-list override, enabling mixed-brand estimates such as Dura + Popular + ADI + HC.';
