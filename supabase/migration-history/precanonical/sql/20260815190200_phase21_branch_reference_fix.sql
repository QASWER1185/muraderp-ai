-- Phase 21 corrective migration: the branch composite key must exist before
-- ERP branch/organization foreign keys are created.

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
