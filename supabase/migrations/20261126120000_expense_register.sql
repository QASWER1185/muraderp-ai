begin;
insert into public.accounts(code,name,account_type,normal_balance,parent_account_id)
select v.code,v.name,v.kind,'DEBIT',case when v.kind='EQUITY' then owner.id end
from (values
 ('5100','Shop Rent Expense','EXPENSE'),('5110','Electricity Expense','EXPENSE'),('5120','Shop Miscellaneous Expense','EXPENSE'),
 ('3100','Owner Drawings — House Rent','EQUITY'),('3110','Owner Drawings — School Fees','EQUITY'),
 ('3120','Owner Drawings — Kitchen & Groceries','EQUITY'),('3130','Owner Drawings — Car Petrol','EQUITY'),
 ('3140','Owner Drawings — Other Personal','EQUITY')
) v(code,name,kind) cross join public.accounts owner where owner.code='3000'
on conflict(code) do nothing;

create function public.post_journal_entry(p_org uuid,p_branch uuid,p_actor uuid,p_key text,p_date date,p_kind text,p_category text,p_funding text,p_amount numeric,p_notes text,p_void uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare original public.journal_entries%rowtype; entry uuid; category_id uuid; funding_id uuid; fingerprint text; source text; scope text;
begin
 perform private.depot_authorize(p_actor,p_org,p_branch,'accounting.post');
 if p_void is not null then
  select * into original from public.journal_entries where id=p_void and organization_id=p_org and branch_id=p_branch and operation_scope='expense.register.post' and status='POSTED' for update;
  if not found then return null; end if;
  select id into entry from public.journal_entries where reversal_of_journal_entry_id=p_void and status='POSTED';
  if found then return jsonb_build_object('id',original.id,'journal_entry_id',entry,'status','VOIDED'); end if;
  source:=original.source_type; scope:='expense.register.void'; p_key:='void-'||p_void; p_date:=original.entry_date; p_notes:='Expense register reversal'; fingerprint:=md5(p_void::text);
 else
  if p_key is null or length(btrim(p_key)) not between 1 and 128 or p_date is null or p_amount is null or p_amount<=0 or p_amount>=1000000000000 or p_amount<>round(p_amount,2)
     or p_notes is null or length(p_notes)>500 or p_notes ~ '[^ -~]' then
   raise exception using errcode='22023',message='Enter a date, positive PKR amount, English notes and idempotency key';
  end if;
  if not coalesce((p_kind='expense' and p_category in ('5100','5110','5120')) or (p_kind='drawings' and p_category in ('3100','3110','3120','3130','3140')),false)
     or not coalesce(p_funding in ('1000','1010'),false) then
   raise exception using errcode='22023',message='Invalid expense category or funding account';
  end if;
  source:=case when p_kind='expense' then 'EXPENSE' else 'DRAWINGS' end; scope:='expense.register.post';
  fingerprint:=md5(jsonb_build_array(p_date,p_kind,p_category,p_funding,p_amount,p_notes)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||p_actor::text||p_key,0));
  select * into original from public.journal_entries where organization_id=p_org and principal_scope=p_actor::text and operation_scope=scope and idempotency_key=p_key;
  if found then
   if original.request_fingerprint<>fingerprint or original.branch_id<>p_branch then raise exception using errcode='23514',message='Idempotency key already used for another entry'; end if;
   return jsonb_build_object('id',original.id,'journal_entry_id',original.id);
  end if;
  select id into category_id from public.accounts where code=p_category and account_type=case when source='EXPENSE' then 'EXPENSE' else 'EQUITY' end and is_active;
  select id into funding_id from public.accounts where code=p_funding and account_type='ASSET' and is_active;
  if category_id is null or funding_id is null then raise exception using errcode='22023',message='Active category and funding accounts required'; end if;
 end if;
 insert into public.journal_entries(organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status,reversal_of_journal_entry_id)
 values(p_org,p_branch,p_actor,p_date,coalesce(nullif(btrim(p_notes),''),'Expense register entry'),source,case when p_void is null then gen_random_uuid()::text else original.source_record_id end,case when p_void is null then 'PRIMARY' else 'REVERSAL' end,p_actor::text,scope,p_key,fingerprint,'DRAFT',p_void) returning id into entry;
 if p_void is null then
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit) values(entry,category_id,p_amount,0),(entry,funding_id,0,p_amount);
 else
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit) select entry,account_id,credit,debit from public.journal_lines where journal_entry_id=p_void;
 end if;
 perform public.assert_journal_entry_balanced(entry);
 update public.journal_entries set status='POSTED' where id=entry;
 return jsonb_build_object('id',coalesce(p_void,entry),'journal_entry_id',entry,'status',case when p_void is null then 'POSTED' else 'VOIDED' end);
end $$;
revoke all on function public.post_journal_entry(uuid,uuid,uuid,text,date,text,text,text,numeric,text,uuid) from public,anon,authenticated;
grant execute on function public.post_journal_entry(uuid,uuid,uuid,text,date,text,text,text,numeric,text,uuid) to service_role;

create function public.expense_register(p_org uuid,p_branch uuid,p_actor uuid,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.depot_authorize(p_actor,p_org,p_branch,'accounting.read');
 return (select coalesce(jsonb_agg(to_jsonb(r) order by r.entry_date desc,r.id),'[]') from (
  select j.id,j.entry_date,j.description,j.source_type,a.code category,a.name category_name,f.code funding,l.debit amount,
   case when exists(select 1 from public.journal_entries x where x.reversal_of_journal_entry_id=j.id and x.status='POSTED') then 'VOIDED' else 'POSTED' end status
  from public.journal_entries j join public.journal_lines l on l.journal_entry_id=j.id and l.debit>0
  join public.accounts a on a.id=l.account_id
  join public.journal_lines c on c.journal_entry_id=j.id and c.credit>0 join public.accounts f on f.id=c.account_id
  where j.organization_id=p_org and j.branch_id=p_branch and j.operation_scope='expense.register.post' and j.status='POSTED' and j.entry_date between p_from and p_to
 ) r);
end $$;
revoke all on function public.expense_register(uuid,uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.expense_register(uuid,uuid,uuid,date,date) to service_role;
commit;
