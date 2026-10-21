DELETE FROM public.stock_movements
WHERE id IN (3, 4)
  AND movement_type = 'PURCHASE'
  AND reference_type = 'PURCHASE'
  AND (reference_id IS NULL OR reference_id = 0)
  AND notes IN (
    'Purchase of 50 Bestway Cement Bags',
    'Transaction engine test - Purchase 50 Bestway Cement Bags'
  );

UPDATE public.inventory AS i
SET quantity = COALESCE((
  SELECT SUM(
    CASE
      WHEN sm.movement_type IN ('PURCHASE', 'OPENING') THEN sm.quantity
      WHEN sm.movement_type IN ('SALE', 'ADJUSTMENT_OUT') THEN -sm.quantity
      ELSE sm.quantity
    END
  )
  FROM public.stock_movements AS sm
  WHERE sm.product_id = i.product_id
    AND sm.warehouse_id = i.warehouse_id
), 0),
updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM public.stock_movements AS sm
  WHERE sm.product_id = i.product_id
    AND sm.warehouse_id = i.warehouse_id
);

CREATE OR REPLACE FUNCTION public.validate_purchase_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.movement_type = 'PURCHASE' THEN
    IF NEW.reference_type <> 'PURCHASE' OR NEW.reference_id IS NULL OR NEW.reference_id <= 0 THEN
      RAISE EXCEPTION 'Purchase stock movement requires a valid purchase reference';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = NEW.reference_id) THEN
      RAISE EXCEPTION 'Purchase stock movement references a non-existent purchase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_purchase_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_validate_purchase_stock_movement
BEFORE INSERT OR UPDATE ON public.stock_movements
FOR EACH ROW
EXECUTE FUNCTION public.validate_purchase_stock_movement();

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_purchase_reference_unique_idx
ON public.stock_movements (reference_id, product_id, warehouse_id)
WHERE movement_type = 'PURCHASE'
  AND reference_type = 'PURCHASE'
  AND reference_id IS NOT NULL;