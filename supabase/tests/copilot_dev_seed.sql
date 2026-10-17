-- The runner loads seed.sql twice before these assertions.
begin;
do $$
declare
  demo_org constant uuid := 'd3000000-0000-4000-8000-000000000001';
  demo_branch constant uuid := 'd3000000-0000-4000-8000-000000000002';
  demo_customer bigint;
  demo_cement bigint;
  demo_pipe bigint;
begin
  if (select count(*) from public.customers where organization_id=demo_org and name='Hamdan Sahib') <> 1 then
    raise exception 'Seed must create exactly one Hamdan Sahib';
  end if;
  select id into strict demo_customer from public.customers where organization_id=demo_org and name='Hamdan Sahib';
  select id into strict demo_cement from public.products where organization_id=demo_org and name='Bestway Cement';
  select id into strict demo_pipe from public.products where organization_id=demo_org and sku='COPILOT-DEMO-PIPE';
  if (select count(*) from public.inventory where organization_id=demo_org and product_id=demo_cement and quantity=0) <> 1 then
    raise exception 'Seed must retain a verified zero cement stock balance';
  end if;
  if (select count(*) from public.inventory where organization_id=demo_org and product_id=demo_pipe and quantity=19) <> 1 then
    raise exception 'Seed replay must not consume stock twice';
  end if;
  if (select count(*) from public.invoices where organization_id=demo_org and branch_id=demo_branch and customer_id=demo_customer and invoice_number='COPILOT-DEMO-001' and status='POSTED') <> 1 then
    raise exception 'Seed must post exactly one invoice in the demo branch';
  end if;
  if (select count(*) from public.customer_ledger_entries where organization_id=demo_org and branch_id=demo_branch and customer_id=demo_customer) <> 1
     or (select sum(debit-credit) from public.customer_ledger_entries where organization_id=demo_org and branch_id=demo_branch and customer_id=demo_customer) is distinct from 1500::numeric then
    raise exception 'Seed must create one authoritative PKR 1500 ledger debit';
  end if;
  if exists (select 1 from public.customer_ledger_entries where customer_id=demo_customer and (organization_id<>demo_org or branch_id<>demo_branch)) then
    raise exception 'Demo ledger must not cross tenant or branch boundaries';
  end if;
end;
$$;
rollback;
