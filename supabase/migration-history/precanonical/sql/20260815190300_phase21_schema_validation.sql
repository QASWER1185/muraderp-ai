-- Phase 21 validation helper. Ensures the tenant/branch schema has the
-- composite key required by branch ownership constraints.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.branches'::regclass
      AND conname = 'branches_id_organization_id_key'
  ) THEN
    ALTER TABLE public.branches
      ADD CONSTRAINT branches_id_organization_id_key UNIQUE (id, organization_id);
  END IF;
END $$;
