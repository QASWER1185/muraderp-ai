-- Phase 2 audit remediation: reconcile materialized inventory balances with the
-- authoritative stock-movement ledger for existing rows.
--
-- Inventory is maintained as a materialized balance, while stock_movements is
-- the durable movement ledger. This migration repairs legacy drift without
-- rewriting movement history.

with movement_totals as (
  select
    product_id,
    warehouse_id,
    sum(
      case
        when movement_type in ('OPENING', 'PURCHASE', 'SALE_RETURN', 'TRANSFER_IN') then quantity
        when movement_type in ('SALE', 'PURCHASE_RETURN', 'TRANSFER_OUT') then -quantity
        else 0
      end
    ) as derived_quantity
  from public.stock_movements
  group by product_id, warehouse_id
)
update public.inventory as inventory_balance
set quantity = movement_totals.derived_quantity,
    updated_at = now()
from movement_totals
where inventory_balance.product_id = movement_totals.product_id
  and inventory_balance.warehouse_id = movement_totals.warehouse_id
  and inventory_balance.quantity <> movement_totals.derived_quantity;

with movement_totals as (
  select
    product_id,
    warehouse_id,
    sum(
      case
        when movement_type in ('OPENING', 'PURCHASE', 'SALE_RETURN', 'TRANSFER_IN') then quantity
        when movement_type in ('SALE', 'PURCHASE_RETURN', 'TRANSFER_OUT') then -quantity
        else 0
      end
    ) as derived_quantity
  from public.stock_movements
  group by product_id, warehouse_id
)
insert into public.inventory (product_id, warehouse_id, quantity)
select
  movement_totals.product_id,
  movement_totals.warehouse_id,
  movement_totals.derived_quantity
from movement_totals
where not exists (
  select 1
  from public.inventory as inventory_balance
  where inventory_balance.product_id = movement_totals.product_id
    and inventory_balance.warehouse_id = movement_totals.warehouse_id
);
