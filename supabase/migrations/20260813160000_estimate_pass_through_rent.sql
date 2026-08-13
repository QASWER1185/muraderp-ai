-- Customer-facing delivery/vehicle rent is collected on the estimate but is
-- explicitly excluded from business sales revenue and estimated profit.
-- It represents a pass-through amount payable to the driver/hauler/provider.

alter table public.estimates
  add column if not exists pass_through_rent numeric not null default 0
    check (pass_through_rent >= 0),
  add column if not exists pass_through_rent_payee text;

comment on column public.estimates.pass_through_rent is
  'Customer-facing delivery/vehicle rent collected as a pass-through; excluded from business revenue/profit.';
comment on column public.estimates.pass_through_rent_payee is
  'Driver/vehicle/hauler or other recipient expected to receive the pass-through rent.';
