create table public.organization_settings (
 organization_id uuid not null references public.organizations(id),
 section text not null check(section in ('company','numbering','templates','tax-currency')),
 value jsonb not null, updated_by uuid not null, updated_at timestamptz not null default now(),
 primary key(organization_id,section)
);
alter table public.organization_settings enable row level security;
revoke all on public.organization_settings from public,anon,authenticated;
grant select,insert,update on public.organization_settings to service_role;
create function public.update_organization_role(p_organization_id uuid,p_user_id uuid,p_role text,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_role text;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not exists(select 1 from public.organization_memberships where organization_id=p_organization_id and user_id=p_actor_user_id and role in ('owner','admin') and status='active') then raise exception using errcode='42501',message='Organization management permission required';end if;
 if p_role not in ('owner','admin','manager','accountant','sales','purchase','inventory','viewer') then raise exception using errcode='22023',message='Invalid role';end if;
 select role into old_role from public.organization_memberships where organization_id=p_organization_id and user_id=p_user_id and status='active' for update;
 if not found then raise exception using errcode='22023',message='Active organization user not found';end if;
 if old_role='owner' and p_role<>'owner' and (select count(*) from public.organization_memberships where organization_id=p_organization_id and role='owner' and status='active')<=1 then raise exception using errcode='23514',message='The organization must retain an active owner';end if;
 update public.organization_memberships set role=p_role where organization_id=p_organization_id and user_id=p_user_id;
end $$;
revoke all on function public.update_organization_role(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.update_organization_role(uuid,uuid,text,uuid) to service_role;
