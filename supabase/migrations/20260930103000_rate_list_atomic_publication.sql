-- Publish a complete draft and retire the previous active version in one transaction.
-- The browser reaches this function only through the authenticated Rate List service.
create or replace function public.publish_rate_list_version(
  p_organization_id uuid,
  p_version_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list_id bigint;
  v_version public.rate_list_versions%rowtype;
  v_active_number integer;
begin
  if p_organization_id is null or p_version_id is null or p_version_id <= 0 then
    raise exception using errcode = '22023', message = 'organization and version are required';
  end if;

  select rl.id into v_list_id
  from public.rate_lists rl
  join public.rate_list_versions rv on rv.rate_list_id = rl.id
  where rv.id = p_version_id and rl.organization_id = p_organization_id and rl.is_active
  for update of rl;
  if v_list_id is null then
    raise exception using errcode = 'P0002', message = 'rate-list version was not found in this organization';
  end if;

  select * into v_version from public.rate_list_versions where id = p_version_id for update;
  if v_version.status <> 'DRAFT' then
    raise exception using errcode = '22023', message = 'only draft rate-list versions may be published';
  end if;
  if not exists (select 1 from public.rate_list_items where rate_list_version_id = p_version_id) then
    raise exception using errcode = '22023', message = 'a rate-list version needs at least one item';
  end if;
  select version_number into v_active_number
  from public.rate_list_versions where rate_list_id = v_list_id and status = 'ACTIVE';
  if v_active_number is not null and v_version.version_number <= v_active_number then
    raise exception using errcode = '22023', message = 'new active version number must increase';
  end if;

  update public.rate_list_versions set status = 'ARCHIVED', updated_at = now()
  where rate_list_id = v_list_id and status = 'ACTIVE';
  update public.rate_list_versions set status = 'ACTIVE', updated_at = now()
  where id = p_version_id returning * into v_version;
  return to_jsonb(v_version);
end;
$$;
revoke all on function public.publish_rate_list_version(uuid, bigint) from public, anon, authenticated;
grant execute on function public.publish_rate_list_version(uuid, bigint) to service_role;
