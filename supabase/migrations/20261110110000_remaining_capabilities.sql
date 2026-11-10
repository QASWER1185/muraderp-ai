create or replace function public.delete_unused_record(p_entity text,p_id bigint,p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare r jsonb; t text; own_items text; ref text; fk record; linked boolean;
begin
  if p_entity not in ('customers','vendors','products','warehouses','estimates','invoices','purchases','rate_lists','rate_list_versions','credit_notes','customer_payments','vendor_payments') then
    raise exception using errcode='22023',message='Unsupported deletion target';
  end if;
  if not public.is_organization_member_for_user(p_actor_user_id,p_organization_id) then
    raise exception using errcode='42501',message='Active organization membership required';
  end if;
  -- Lock parent first: FK writers cannot race the reference checks.
  if p_entity='rate_list_versions' then
    execute 'select to_jsonb(v) from public.rate_list_versions v join public.rate_lists l on l.id=v.rate_list_id where v.id=$1 and l.organization_id=$2 for update of v,l' into r using p_id,p_organization_id;
  else
    execute format('select to_jsonb(t) from public.%I t where id=$1 and organization_id=$2 for update',p_entity) into r using p_id,p_organization_id;
  end if;
  if r is null then return false; end if;
  if r ? 'branch_id' and r->>'branch_id' is distinct from p_branch_id::text then
    return false;
  end if;
  if r ? 'status' and r->>'status'<>'DRAFT' and not (p_entity='rate_list_versions' and r->>'status'='ARCHIVED') then
    raise exception using errcode='23514',message='Cannot delete a posted or active record. Only drafts can be deleted; use the correction workflow for posted documents.';
  end if;
  if p_entity='rate_list_versions' and (exists(select 1 from public.invoice_items x where to_jsonb(x)->>'rate_list_version_id'=p_id::text) or exists(select 1 from public.invoices x where to_jsonb(x)->>'rate_list_version_id'=p_id::text)) then raise exception using errcode='23514',message='Cannot delete: version is referenced by invoices.'; end if;
  ref := case p_entity when 'invoices' then 'INVOICE' when 'purchases' then 'PURCHASE' when 'credit_notes' then 'CREDIT_NOTE' when 'customer_payments' then 'CUSTOMER_PAYMENT' when 'vendor_payments' then 'VENDOR_PAYMENT' else null end;
  if ref is not null then
    foreach t in array array['stock_movements','customer_ledger_entries','vendor_payable_ledger_entries'] loop
      execute format('select exists(select 1 from public.%I where reference_type=$1 and reference_id=$2)',t) into linked using ref,p_id;
      if linked then raise exception using errcode='23514',message='Cannot delete: linked stock movements or ledger entries exist.'; end if;
    end loop;
    if exists(select 1 from public.journal_entries where source_type=ref and source_record_id=p_id::text)
       or exists(select 1 from public.accounting_journal_entries where source_type=ref and source_id=p_id) then
      raise exception using errcode='23514',message='Cannot delete: linked accounting entries exist.';
    end if;
  end if;
  own_items := case p_entity when 'estimates' then 'estimate_items' when 'invoices' then 'invoice_items' when 'purchases' then 'purchase_items' when 'credit_notes' then 'credit_note_items' when 'rate_list_versions' then 'rate_list_items' else null end;
  -- Inspect every incoming FK, including nullable and cascading references.
  for fk in
    select c.conrelid::regclass as rel, a.attname as col, cl.relname as name
    from pg_constraint c join pg_class cl on cl.oid=c.conrelid
    cross join lateral unnest(c.conkey,c.confkey) keys(child,parent)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=keys.child
    join pg_attribute parent on parent.attrelid=c.confrelid and parent.attnum=keys.parent and parent.attname='id'
    where c.contype='f' and c.confrelid=format('public.%I',p_entity)::regclass
  loop
    if fk.name=own_items or (p_entity='invoices' and fk.name='invoice_transaction_events') or (p_entity='estimates' and fk.name='estimate_idempotency_keys') then continue; end if;
    execute format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) into linked using p_id;
    if linked then raise exception using errcode='23514',message=format('Cannot delete: linked %s records exist.',fk.name); end if;
  end loop;
  insert into public.record_deletion_events(organization_id,actor_user_id,entity,record_id,snapshot) values(p_organization_id,p_actor_user_id,p_entity,p_id,r);
  if p_entity='estimates' then
    update public.estimate_idempotency_keys set estimate_id=null where estimate_id=p_id;
  end if;
  if own_items is not null then
    t := case p_entity when 'rate_list_versions' then 'rate_list_version_id' when 'credit_notes' then 'credit_note_id' else left(p_entity,length(p_entity)-1)||'_id' end;
    execute format('delete from public.%I where %I=$1',own_items,t) using p_id;
  end if;
  execute format('delete from public.%I where id=$1',p_entity) using p_id;
  return true;
end $$;
revoke all on function public.delete_unused_record(text,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_unused_record(text,bigint,uuid,uuid,uuid) to service_role;

create function public.delete_rate_list_version_scoped(p_list_id bigint,p_version_id bigint,p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.rate_lists where id=p_list_id and organization_id=p_organization_id for update;
 if not found then return false;end if;
 perform 1 from public.rate_list_versions where id=p_version_id and rate_list_id=p_list_id for update;
 if not found then return false;end if;
 return public.delete_unused_record('rate_list_versions',p_version_id,p_organization_id,p_branch_id,p_actor_user_id);
end $$;
revoke all on function public.delete_rate_list_version_scoped(bigint,bigint,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_rate_list_version_scoped(bigint,bigint,uuid,uuid,uuid) to service_role;

create function public.save_organization_settings(p_organization_id uuid,p_actor_user_id uuid,p_updates jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare section_record record; child record; old_value jsonb; merged jsonb; answer jsonb;
begin
 perform 1 from public.organizations where id=p_organization_id for update;
 if not exists(select 1 from public.organization_memberships m join public.role_permissions rp on rp.role=m.role where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.status='active' and rp.permission_code='organization.manage') then raise exception using errcode='42501',message='Organization management permission required';end if;
 if p_updates is null or jsonb_typeof(p_updates)<>'object' or p_updates='{}'::jsonb then raise exception using errcode='22023',message='Provide settings to save';end if;
 for section_record in select key,value from jsonb_each(p_updates) order by key loop
  if section_record.key not in ('company','numbering','templates','tax-currency') or jsonb_typeof(section_record.value)<>'object' then raise exception using errcode='22023',message='Invalid settings section';end if;
  select value into old_value from public.organization_settings where organization_id=p_organization_id and section=section_record.key;
  merged:=coalesce(old_value,'{}'::jsonb)||section_record.value;
  if section_record.key='numbering' then
   for child in select key,value from jsonb_each(section_record.value) loop
    merged:=jsonb_set(merged,array[child.key],coalesce(old_value->child.key,'{}'::jsonb)||child.value);
   end loop;
  end if;
  insert into public.organization_settings(organization_id,section,value,updated_by,updated_at) values(p_organization_id,section_record.key,merged,p_actor_user_id,now()) on conflict(organization_id,section) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 end loop;
 select coalesce(jsonb_object_agg(section,value),'{}'::jsonb) into answer from public.organization_settings where organization_id=p_organization_id;
 return answer;
end $$;
revoke all on function public.save_organization_settings(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_organization_settings(uuid,uuid,jsonb) to service_role;
