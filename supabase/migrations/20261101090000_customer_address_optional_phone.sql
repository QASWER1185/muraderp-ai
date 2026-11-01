-- Customer-only additive change. Existing records and city constraints are preserved.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS address TEXT NULL;
ALTER TABLE public.customers ALTER COLUMN phone DROP NOT NULL;
NOTIFY pgrst, 'reload schema';
