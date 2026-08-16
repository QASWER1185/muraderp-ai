-- Phase 21 follow-up guard: ensure composite branch/organization references are valid.
-- This migration is intentionally separate so it can be reviewed independently.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.branches'::regclass
      and conname = 'branches_id_organization_id_key'
  ) then
    alter table public.branches
      add constraint branches_id_organization_id_key unique (id, organization_id);
  end if;
end
$$;
