begin;

-- This company rate list was imported as customer-scoped even though its
-- catalog prices are intended for every customer in the organization.
update public.rate_lists
set name = 'Dura Flow - Store-Wide - existing ERP product rates',
    scope_type = 'GLOBAL',
    customer_id = null,
    updated_at = now()
where code = 'DURAFLOW-C23-ERP-20261025'
  and price_type = 'SALE'
  and scope_type = 'CUSTOMER'
  and customer_id = 23
  and vendor_id is null;

do $$
begin
  if not exists (
    select 1
    from public.rate_lists
    where code = 'DURAFLOW-C23-ERP-20261025'
      and price_type = 'SALE'
      and scope_type = 'GLOBAL'
      and customer_id is null
      and vendor_id is null
  ) then
    raise exception 'Dura Flow rate list was not promoted to store-wide scope';
  end if;
end;
$$;

commit;
