-- Persist the two mobile document views without changing financial columns.
alter table public.estimates
  add column if not exists document_template text not null default 'sanitary_electric'
  check (document_template in ('sanitary_electric', 'building_material'));

alter table public.invoices
  add column if not exists document_template text not null default 'sanitary_electric'
  check (document_template in ('sanitary_electric', 'building_material'));

-- create_estimate_atomic already carries layout_key through its JSON definition.
-- Encode the two values after a delimiter, then restore the existing desktop
-- layout key before the table constraints are checked.
create or replace function public.apply_estimate_document_template()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_delimiter integer;
  v_template text;
begin
  v_delimiter := strpos(new.layout_key, '|');
  if v_delimiter > 0 then
    v_template := substring(new.layout_key from v_delimiter + 1);
    if v_template in ('sanitary_electric', 'building_material') then
      new.document_template := v_template;
      new.layout_key := substring(new.layout_key from 1 for v_delimiter - 1);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists estimates_document_template_before_insert on public.estimates;
create trigger estimates_document_template_before_insert
before insert on public.estimates
for each row execute function public.apply_estimate_document_template();

-- Preserve the existing scoped authorization and edit guards, then persist the
-- presentation choice in the same transaction as the estimate edit.
alter function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb)
  rename to update_estimate_scoped_template_impl;

create function public.update_estimate_scoped(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_estimate_id bigint,
  p_changes jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_template text;
begin
  if p_changes ? 'document_template' then
    v_template := p_changes->>'document_template';
    if v_template is null or v_template not in ('sanitary_electric', 'building_material') then
      raise exception 'Invalid document template';
    end if;
  end if;

  perform public.update_estimate_scoped_template_impl(
    p_organization_id, p_branch_id, p_actor_user_id, p_estimate_id, p_changes
  );

  if p_changes ? 'document_template' then
    select status into v_status
    from public.estimates
    where id = p_estimate_id
      and organization_id = p_organization_id
      and branch_id = p_branch_id
    for update;
    if not found or v_status <> 'DRAFT' then
      raise exception 'Only draft estimates can change their document template';
    end if;
    update public.estimates
      set document_template = v_template, updated_at = clock_timestamp()
      where id = p_estimate_id;
  end if;
end;
$$;

revoke all on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.update_estimate_scoped(uuid,uuid,uuid,bigint,jsonb) to service_role;

-- The authoritative posting function continues to own all totals, inventory,
-- receivable and journal work. This wrapper only saves the presentation key.
alter function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint)
  rename to post_invoice_atomic_template_impl;

revoke all on function public.post_invoice_atomic_template_impl(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint)
  from public, anon, authenticated, service_role;

create function public.post_invoice_atomic(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_operation_scope text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb,
  p_lines jsonb,
  p_warehouse_id bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_template text;
  v_invoice_id bigint;
begin
  v_template := coalesce(nullif(p_invoice->>'document_template', ''), 'sanitary_electric');
  if p_invoice->>'source_type' = 'FROM_ESTIMATE' then
    select e.document_template into v_template
    from public.estimates e
    where e.id = nullif(p_invoice->>'source_estimate_id', '')::bigint
      and e.organization_id = p_organization_id
      and e.branch_id = p_branch_id;
    if not found then
      raise exception using errcode = '23503', message = 'source estimate is not available';
    end if;
  end if;
  if v_template not in ('sanitary_electric', 'building_material') then
    raise exception using errcode = '22023', message = 'invalid invoice document template';
  end if;

  v_result := public.post_invoice_atomic_template_impl(
    p_organization_id, p_branch_id, p_actor_user_id, p_service_principal,
    p_operation_scope, p_idempotency_key, p_request_fingerprint,
    p_invoice, p_lines, p_warehouse_id
  );

  if coalesce((v_result->>'replayed')::boolean, false) then
    return v_result;
  end if;

  v_invoice_id := (v_result->>'invoice_id')::bigint;
  update public.invoices
    set document_template = v_template
    where id = v_invoice_id
      and organization_id = p_organization_id
      and branch_id = p_branch_id;
  if not found then
    raise exception using errcode = '23503', message = 'posted invoice is not available';
  end if;
  return v_result;
end;
$$;

alter function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) owner to postgres;
revoke all on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) to service_role;
comment on function public.post_invoice_atomic(uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,bigint) is
  'Service-role-only authoritative invoice posting; presentation template is inherited from a source estimate or saved from the direct invoice choice.';
