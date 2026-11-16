begin;
-- Cancelled estimates have no financial posting. Archive their owned derived
-- suggestion facts and line items in the immutable deletion audit, preserving
-- all invoice, dispatch and other business-child guards.
create or replace function public.reverse_record_atomic(p_entity text,p_id bigint,p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_action text default 'DELETE',p_dry_run boolean default false,p_expected_fingerprint text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 r jsonb; ref text; own_table text; own_col text; fk record; linked boolean; blockers text[]:='{}';
 stocks jsonb:='[]'; ledgers jsonb:='[]'; customers jsonb:='[]'; vendors jsonb:='[]'; removed_stock jsonb:='[]'; removed_customer jsonb:='[]'; removed_vendor jsonb:='[]'; removed_learning jsonb:='[]'; removed_items jsonb:='[]';
 summary jsonb; fingerprint text; m record; journal_row record; rev uuid; old_ids bigint[]:='{}'; journal_count integer; balance_amount numeric; financial boolean; prior_void boolean;
begin
 if p_entity not in ('customers','vendors','products','warehouses','estimates','invoices','purchases','rate_lists','rate_list_versions','credit_notes','customer_payments','vendor_payments') or p_action not in ('DELETE','VOID') or (p_action='VOID' and p_entity<>'invoices') then
  raise exception using errcode='22023',message='Unsupported reversal target or action';
 end if;
 if not public.is_organization_member_for_user(p_actor_user_id,p_organization_id) or not exists(select 1 from public.branches where id=p_branch_id and organization_id=p_organization_id and status='active') then raise exception using errcode='42501',message='Active organization and branch membership required';end if;
 if p_entity='rate_list_versions' then
  select to_jsonb(v) into r from public.rate_list_versions v join public.rate_lists l on l.id=v.rate_list_id where v.id=p_id and l.organization_id=p_organization_id for update of v,l;
 else
  execute format('select to_jsonb(t) from public.%I t where id=$1 and organization_id=$2 for update',p_entity) into r using p_id,p_organization_id;
 end if;
 if r is null or (r ? 'branch_id' and r->>'branch_id' is distinct from p_branch_id::text) then return null;end if;
 -- Serialize with payment and return writers before recalculating invoice status.
 if p_entity='customer_payments' then
  perform 1 from public.invoices i join public.customer_payment_allocations a on a.invoice_id=i.id where a.payment_id=p_id order by i.id for update of i;
 elsif p_entity='credit_notes' then
  perform 1 from public.invoices where id=(r->>'invoice_id')::bigint for update;
 end if;
 prior_void:=coalesce(r->>'status','') in ('VOID','VOIDED');
 if p_action='VOID' and prior_void then return jsonb_build_object('entity',p_entity,'id',p_id,'action',p_action,'already_reversed',true,'allowed',true);end if;
 ref:=case p_entity when 'invoices' then 'INVOICE' when 'purchases' then 'PURCHASE' when 'credit_notes' then 'CREDIT_NOTE' when 'customer_payments' then 'CUSTOMER_PAYMENT' when 'vendor_payments' then 'VENDOR_PAYMENT' end;
 own_table:=case p_entity when 'estimates' then 'estimate_items' when 'invoices' then 'invoice_items' when 'purchases' then 'purchase_items' when 'credit_notes' then 'credit_note_items' when 'rate_list_versions' then 'rate_list_items' end;
 own_col:=case p_entity when 'estimates' then 'estimate_id' when 'invoices' then 'invoice_id' when 'purchases' then 'purchase_id' when 'credit_notes' then 'credit_note_id' when 'rate_list_versions' then 'rate_list_version_id' end;
 if own_table is not null then
  execute format('select coalesce(jsonb_agg(to_jsonb(t) order by id),''[]'') from public.%I t where %I=$1',own_table,own_col) into removed_items using p_id;
 end if;
 if p_entity='estimates' then
  select coalesce(jsonb_agg(to_jsonb(e) order by trigger_product_id,companion_product_id),'[]') into removed_learning from public.companion_learning_events e where estimate_id=p_id and organization_id=p_organization_id and branch_id=p_branch_id;
  if r->>'status' not in ('DRAFT','READY','CANCELLED') then blockers:=array_append(blockers,'Only unconverted draft, ready or cancelled estimates can be deleted');end if;
 end if;
 -- Parent row lock prevents new child FK references racing dependency checks.
 for fk in select c.conrelid::regclass rel,a.attname col,cl.relname name from pg_constraint c join pg_class cl on cl.oid=c.conrelid cross join lateral unnest(c.conkey,c.confkey) k(child,parent) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.child join pg_attribute p on p.attrelid=c.confrelid and p.attnum=k.parent and p.attname='id' where c.contype='f' and c.confrelid=format('public.%I',p_entity)::regclass loop
  if fk.name=own_table or (p_entity='invoices' and fk.name in ('invoice_transaction_events','sales_transaction_idempotency_keys')) or (p_entity='estimates' and fk.name in ('estimate_idempotency_keys','companion_learning_events')) or (p_entity='purchases' and fk.name='purchase_idempotency_keys') or (p_entity='credit_notes' and fk.name='credit_note_idempotency_keys') or (p_entity='customer_payments' and fk.name in ('customer_payment_allocations','customer_payment_idempotency_keys')) or (p_entity='vendor_payments' and fk.name in ('vendor_payment_allocations','vendor_payment_idempotency_keys')) then continue;end if;
  execute format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) into linked using p_id;
  if linked then blockers:=array_append(blockers,format('Linked %s records prevent %s',fk.name,lower(p_action)));end if;
 end loop;
 if ref is not null then
  perform 1 from public.journal_entries where organization_id=p_organization_id and branch_id=p_branch_id and source_type=ref and source_record_id=p_id::text order by id for update;
  select count(*) into journal_count from public.journal_entries j where j.organization_id=p_organization_id and j.branch_id=p_branch_id and j.source_type=ref and j.source_record_id=p_id::text and j.status='POSTED' and j.posting_kind='PRIMARY' and not exists(select 1 from public.journal_entries reversal where reversal.reversal_of_journal_entry_id=j.id and reversal.status='POSTED');
  financial:=journal_count>0;
  if not financial and not prior_void and coalesce(r->>'status','POSTED')<>'DRAFT' then blockers:=array_append(blockers,'No unreversed authoritative posted journal; reconciliation is required');end if;
  -- Lock warehouse balances in a stable order, matching normal stock writers.
  for m in select distinct product_id,warehouse_id from public.stock_movements where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id order by product_id,warehouse_id loop
   perform 1 from public.inventory where organization_id=p_organization_id and product_id=m.product_id and warehouse_id=m.warehouse_id for update;
   if not found then blockers:=array_append(blockers,format('Missing inventory balance for product %s',m.product_id));end if;
   select coalesce(sum(coalesce(quantity_delta,case when movement_type in ('SALE','PURCHASE_RETURN','TRANSFER_OUT') then -abs(quantity) else quantity end)),0) into balance_amount from public.stock_movements where organization_id=p_organization_id and product_id=m.product_id and warehouse_id=m.warehouse_id and (branch_id=p_branch_id and reference_type=ref and reference_id=p_id) is not true;
   stocks:=stocks||jsonb_build_array(jsonb_build_object('product_id',m.product_id,'warehouse_id',m.warehouse_id,'before',(select quantity from public.inventory where organization_id=p_organization_id and product_id=m.product_id and warehouse_id=m.warehouse_id),'after',balance_amount,'quantity_change',balance_amount-(select quantity from public.inventory where organization_id=p_organization_id and product_id=m.product_id and warehouse_id=m.warehouse_id)));
   if balance_amount<0 then blockers:=array_append(blockers,format('Product %s (%s), warehouse %s would have negative stock %s',m.product_id,(select name from public.products where id=m.product_id),m.warehouse_id,balance_amount));end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into removed_stock from public.stock_movements s where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into removed_customer from public.customer_ledger_entries s where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') into removed_vendor from public.vendor_payable_ledger_entries s where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  for m in select distinct customer_id,currency_code from public.customer_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id order by customer_id,currency_code loop
   perform 1 from public.customers where id=m.customer_id and organization_id=p_organization_id for update;
   select coalesce(sum(debit-credit),0) into balance_amount from public.customer_ledger_entries where organization_id=p_organization_id and customer_id=m.customer_id and currency_code=m.currency_code and (branch_id=p_branch_id and reference_type=ref and reference_id=p_id) is not true;
   customers:=customers||jsonb_build_array(jsonb_build_object('customer_id',m.customer_id,'currency',m.currency_code,'balance_after',balance_amount,'balance_change',-(select coalesce(sum(debit-credit),0) from public.customer_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id and customer_id=m.customer_id and currency_code=m.currency_code)));
  end loop;
  for m in select distinct vendor_id from public.vendor_payable_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id order by vendor_id loop
   perform 1 from public.vendors where id=m.vendor_id and organization_id=p_organization_id for update;
   select coalesce(sum(debit-credit),0) into balance_amount from public.vendor_payable_ledger_entries where organization_id=p_organization_id and vendor_id=m.vendor_id and (branch_id=p_branch_id and reference_type=ref and reference_id=p_id) is not true;
   vendors:=vendors||jsonb_build_array(jsonb_build_object('vendor_id',m.vendor_id,'balance_after',balance_amount,'balance_change',-(select coalesce(sum(debit-credit),0) from public.vendor_payable_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id and vendor_id=m.vendor_id)));
  end loop;
  select coalesce(jsonb_agg(to_jsonb(d) order by d.code),'[]') into ledgers from (select a.code,sum(l.credit-l.debit) debit_minus_credit_change,sum(l.credit) reversal_debit,sum(l.debit) reversal_credit from public.journal_entries j join public.journal_lines l on l.journal_entry_id=j.id join public.accounts a on a.id=l.account_id where j.organization_id=p_organization_id and j.branch_id=p_branch_id and j.source_type=ref and j.source_record_id=p_id::text and j.status='POSTED' and j.posting_kind='PRIMARY' and not exists(select 1 from public.journal_entries reversal where reversal.reversal_of_journal_entry_id=j.id and reversal.status='POSTED') group by a.code) d;
 elsif p_entity<>'estimates' and r ? 'status' and r->>'status'<>'DRAFT' then blockers:=array_append(blockers,'Only draft versions and estimates can be deleted');
 end if;
 if p_action='VOID' and coalesce(r->>'status','')='DRAFT' then blockers:=array_append(blockers,'Draft invoices must be deleted instead of voided');end if;
 summary:=jsonb_build_object('entity',p_entity,'id',p_id,'action',p_action,'posted',coalesce(financial,false),'record',r,'stock',stocks,'ledger_delta',ledgers,'customer_balances',customers,'vendor_balances',vendors,'derived_learning_events',jsonb_array_length(removed_learning),'line_items_count',jsonb_array_length(removed_items),'allowed',cardinality(blockers)=0,'blockers',to_jsonb(blockers));
 fingerprint:=md5(summary::text||removed_stock::text||removed_customer::text||removed_vendor::text||removed_learning::text||removed_items::text);
 summary:=summary||jsonb_build_object('fingerprint',fingerprint);
 if p_dry_run then return summary;end if;
 if cardinality(blockers)>0 then raise exception using errcode='23514',message=array_to_string(blockers,'; ');end if;
 if p_expected_fingerprint is not null and p_expected_fingerprint<>fingerprint then raise exception using errcode='23514',message='Reversal impact changed; refresh the summary and confirm again';end if;
 if p_entity='estimates' then
  insert into public.record_deletion_events(organization_id,actor_user_id,entity,record_id,snapshot) values(p_organization_id,p_actor_user_id,p_entity,p_id,r);
  delete from public.companion_learning_events where estimate_id=p_id and organization_id=p_organization_id and branch_id=p_branch_id;
  update public.estimate_idempotency_keys set estimate_id=null where estimate_id=p_id;
  delete from public.estimate_items where estimate_id=p_id;
  delete from public.estimates where id=p_id;
 elsif ref is null or (not coalesce(financial,false) and not prior_void) then
  if not public.delete_unused_record(p_entity,p_id,p_organization_id,p_branch_id,p_actor_user_id) then return null;end if;
 else
  -- Offset immutable journals on their original accounting date so period
  -- reports reconcile after deletion; audit timestamp records execution time.
  for journal_row in select * from public.journal_entries e where e.organization_id=p_organization_id and e.branch_id=p_branch_id and e.source_type=ref and e.source_record_id=p_id::text and e.status='POSTED' and e.posting_kind='PRIMARY' and not exists(select 1 from public.journal_entries reversal where reversal.reversal_of_journal_entry_id=e.id and reversal.status='POSTED') order by e.id loop
   insert into public.journal_entries(organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status,reversal_of_journal_entry_id) values(p_organization_id,p_branch_id,p_actor_user_id,journal_row.entry_date,'Record reversal: '||p_entity||' #'||p_id,ref,p_id::text,'REVERSAL','record-reversal-engine','records.reverse','reverse-'||journal_row.id,md5(journal_row.id::text),'DRAFT',journal_row.id) returning id into rev;
   insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) select rev,account_id,credit,debit,'Atomic record reversal' from public.journal_lines where journal_entry_id=journal_row.id;
   perform public.assert_journal_entry_balanced(rev);update public.journal_entries set status='POSTED' where id=rev;
  end loop;
  if p_entity='customer_payments' then select coalesce(array_agg(invoice_id),'{}') into old_ids from public.customer_payment_allocations where payment_id=p_id;delete from public.customer_payment_allocations where payment_id=p_id;end if;
  if p_entity='credit_notes' then old_ids:=array[(r->>'invoice_id')::bigint];end if;
  if p_entity='vendor_payments' then delete from public.vendor_payment_allocations where payment_id=p_id;end if;
  delete from public.stock_movements where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  delete from public.customer_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  delete from public.vendor_payable_ledger_entries where organization_id=p_organization_id and branch_id=p_branch_id and reference_type=ref and reference_id=p_id;
  for m in select * from jsonb_to_recordset(stocks) as t(product_id bigint,warehouse_id bigint,after numeric) loop
   update public.inventory set quantity=m.after,updated_at=now() where organization_id=p_organization_id and product_id=m.product_id and warehouse_id=m.warehouse_id;
  end loop;
  if p_action='VOID' then
   update public.invoices set status='VOIDED',updated_at=now() where id=p_id;
   insert into public.invoice_transaction_events(invoice_id,event_type,principal_id) values(p_id,'VOIDED','record-reversal-engine');
  else
   -- Retain idempotency keys as tombstones: a replay must never resurrect a
   -- deleted record or return a stale successful creation response.
   for fk in select c.conrelid::regclass rel,a.attname col,cl.relname name from pg_constraint c join pg_class cl on cl.oid=c.conrelid cross join lateral unnest(c.conkey,c.confkey) k(child,parent) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.child join pg_attribute p on p.attrelid=c.confrelid and p.attnum=k.parent and p.attname='id' where c.contype='f' and c.confrelid=format('public.%I',p_entity)::regclass and cl.relname like '%idempotency_keys' loop
    if fk.name='purchase_idempotency_keys' then
     update public.purchase_idempotency_keys set purchase_id=null,reversed_at=now(),response_status=410,response_body=jsonb_build_object('error',jsonb_build_object('code','RECORD_DELETED','message','The purchase was deleted with atomic reversal')) where purchase_id=p_id;
    else
     execute format('update %s set %I=null where %I=$1',fk.rel,fk.col,fk.col) using p_id;
    end if;
   end loop;
   if own_table is not null then execute format('delete from public.%I where %I=$1',own_table,own_col) using p_id;end if;
   execute format('delete from public.%I where id=$1',p_entity) using p_id;
  end if;
  for m in select unnest(old_ids) id loop
   update public.invoices i set status=case when coalesce((select sum(amount) from public.customer_payment_allocations where invoice_id=i.id),0)+coalesce((select sum(grand_total) from public.credit_notes where invoice_id=i.id and status='POSTED'),0)>=i.grand_total+i.pass_through_rent then 'PAID' when coalesce((select sum(amount) from public.customer_payment_allocations where invoice_id=i.id),0)+coalesce((select sum(grand_total) from public.credit_notes where invoice_id=i.id and status='POSTED'),0)>0 then 'PARTIALLY_PAID' else 'POSTED' end,updated_at=now() where i.id=m.id and i.organization_id=p_organization_id and i.branch_id=p_branch_id and i.status not in ('DRAFT','VOID','VOIDED');
  end loop;
 end if;
 insert into public.audit_logs(organization_id,branch_id,user_id,entity_type,entity_id,action,reversal_summary) values(p_organization_id,p_branch_id,p_actor_user_id,p_entity,p_id,p_action,summary||jsonb_build_object('removed_stock_movements',removed_stock,'removed_customer_ledger',removed_customer,'removed_vendor_ledger',removed_vendor,'removed_learning_events',removed_learning,'removed_line_items',removed_items));
 return summary||jsonb_build_object('completed',true);
end $$;

commit;
