-- Sale-only product masters may have an unknown purchase cost.
-- Posting continues to require an authoritative unit cost.
alter table public.products alter column purchase_price drop not null;
