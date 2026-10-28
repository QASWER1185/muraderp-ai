-- Branch-only migration. No historical estimates, prices, journals or balances are modified.
create table public.copilot_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  category text not null check (category in ('shorthand','brand_rule','customer_pref')),
  key text not null check (length(key) between 1 and 200),
  value text not null check (length(value) between 1 and 2000),
  evidence text not null check (length(evidence) between 1 and 4000),
  verified_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (organization_id,branch_id,category,key)
);
create table public.copilot_v2_conversations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  branch_id uuid not null references public.branches(id),
  user_id uuid not null references auth.users(id),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  pending jsonb,
  executions jsonb not null default '[]'::jsonb check (jsonb_typeof(executions)='array'),
  version integer not null default 0 check (version >= 0),
  lease uuid,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create index on public.copilot_v2_conversations(organization_id,branch_id,user_id,updated_at desc);
alter table public.copilot_memories enable row level security;
alter table public.copilot_v2_conversations enable row level security;
-- Browser clients cannot write their own verification evidence, actor or lease.
revoke all on public.copilot_memories, public.copilot_v2_conversations from anon, authenticated;
grant all on public.copilot_memories, public.copilot_v2_conversations to service_role;
create function public.copilot_v2_check_branch() returns trigger language plpgsql set search_path=public as $$
begin
  if not exists(select 1 from public.branches where id=new.branch_id and organization_id=new.organization_id) then
    raise exception 'Branch is outside the organization' using errcode='42501';
  end if;
  return new;
end $$;
create trigger copilot_memory_branch before insert or update on public.copilot_memories for each row execute function public.copilot_v2_check_branch();
create trigger copilot_conversation_branch before insert or update on public.copilot_v2_conversations for each row execute function public.copilot_v2_check_branch();
