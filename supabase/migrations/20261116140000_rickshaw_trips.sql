begin;
insert into public.accounts(code,name,account_type,normal_balance,is_active)
values('2150','Carriage Payable - Rickshaw','LIABILITY','CREDIT',true) on conflict(code) do nothing;
do $$ begin if not exists(select 1 from public.accounts where code='2150' and name='Carriage Payable - Rickshaw' and account_type='LIABILITY' and normal_balance='CREDIT' and is_active) or not exists(select 1 from public.accounts where code='1010' and account_type='ASSET' and is_active) then raise exception 'Rickshaw balance sheet accounts are unavailable';end if;end $$;
create table public.drivers(
 id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id), branch_id uuid not null references public.branches(id),
 name text not null check(btrim(name)<>''),phone text not null default '',plate_number text not null default '',is_active boolean not null default true,
 created_at timestamptz not null default now(),unique(organization_id,branch_id,id)
);
create table public.rickshaw_trips(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
 date date not null default current_date,driver_id bigint not null,
 material text not null check(material in ('cement','sand','bajri','bricks','other')),
 quantity numeric(20,4) not null check(quantity>0),unit text not null check(unit in ('bags','trolley','cft')),
 rate_type text not null check(rate_type in ('FIXED','PER_UNIT')),rate numeric(20,4) not null check(rate>0),
 amount numeric(20,4) generated always as (case when rate_type='FIXED' then rate else quantity*rate end) stored,
 customer_id bigint references public.customers(id),invoice_id bigint references public.invoices(id),notes text not null default '',
 paid_amount numeric(20,4) not null default 0,is_paid boolean not null default false,
 journal_entry_id uuid references public.journal_entries(id),revision integer not null default 1,
 idempotency_key text not null,request_fingerprint text not null,created_at timestamptz not null default now(),
 foreign key(organization_id,branch_id,driver_id) references public.drivers(organization_id,branch_id,id),
 check(paid_amount>=0 and paid_amount<=amount),check(is_paid=(paid_amount=amount)),
 unique(organization_id,branch_id,idempotency_key)
);
create table public.driver_payments(
 id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),branch_id uuid not null references public.branches(id),
 driver_id bigint not null,date date not null default current_date,amount numeric(20,4) not null check(amount>0),payment_method text not null default 'CASH' check(payment_method in ('CASH','BANK')),
 journal_entry_id uuid references public.journal_entries(id),idempotency_key text not null,request_fingerprint text not null,created_at timestamptz not null default now(),
 foreign key(organization_id,branch_id,driver_id) references public.drivers(organization_id,branch_id,id),unique(organization_id,branch_id,idempotency_key)
);
create table public.driver_payment_allocations(
 payment_id bigint not null references public.driver_payments(id),trip_id bigint not null references public.rickshaw_trips(id),amount numeric(20,4) not null check(amount>0),primary key(payment_id,trip_id)
);
create index rickshaw_trips_day on public.rickshaw_trips(organization_id,branch_id,date,driver_id);
create index driver_payments_day on public.driver_payments(organization_id,branch_id,date,driver_id);
alter table public.drivers enable row level security;
alter table public.rickshaw_trips enable row level security;
alter table public.driver_payments enable row level security;
alter table public.driver_payment_allocations enable row level security;
revoke all on public.drivers,public.rickshaw_trips,public.driver_payments,public.driver_payment_allocations from public,anon,authenticated,service_role;
grant select on public.drivers,public.rickshaw_trips,public.driver_payments,public.driver_payment_allocations to service_role;

create function private.rickshaw_authorize(p_org uuid,p_branch uuid,p_actor uuid) returns void language plpgsql set search_path=public,pg_temp as $$
begin if not public.is_organization_member_for_user(p_actor,p_org) or not exists(select 1 from public.branches where id=p_branch and organization_id=p_org and status='active') then raise exception using errcode='42501',message='Active organization and branch access required';end if;end $$;
-- Only these two balance-sheet accounts can be posted by this module.
create function private.rickshaw_journal(p_org uuid,p_branch uuid,p_actor uuid,p_date date,p_source text,p_record bigint,p_kind text,p_amount numeric,p_in boolean,p_reverse uuid default null)
returns uuid language plpgsql set search_path=public,pg_temp as $$
declare j uuid;cash public.accounts.id%type;payable public.accounts.id%type;
begin
 select id into cash from public.accounts where code='1010' and account_type='ASSET' and is_active;
 select id into payable from public.accounts where code='2150' and account_type='LIABILITY' and is_active;
 if cash is null or payable is null then raise exception using errcode='23514',message='Rickshaw balance sheet accounts are unavailable';end if;
 if p_reverse is not null and not exists(select 1 from public.journal_entries where id=p_reverse and organization_id=p_org and branch_id=p_branch and source_type=p_source and source_record_id=p_record::text and status='POSTED') then raise exception using errcode='23514',message='Trip posting requires reconciliation';end if;
 if p_reverse is not null and exists(select 1 from public.journal_entries where reversal_of_journal_entry_id=p_reverse and status='POSTED') then raise exception using errcode='23514',message='Trip posting was already reversed';end if;
 if p_reverse is not null and exists(select 1 from public.journal_lines where journal_entry_id=p_reverse and account_id not in(cash,payable)) then raise exception using errcode='23514',message='Rickshaw journals may contain only accounts 1010 and 2150';end if;
 insert into public.journal_entries(organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status,reversal_of_journal_entry_id)
 values(p_org,p_branch,p_actor,p_date,'Rickshaw pass-through',p_source,p_record::text,p_kind,'rickshaw-register','rickshaw.post',p_source||'-'||p_record||'-'||p_kind,md5(p_record::text||p_kind||p_amount::text),'DRAFT',p_reverse) returning id into j;
 if p_reverse is not null then
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) select j,account_id,credit,debit,'Rickshaw pass-through reversal' from public.journal_lines where journal_entry_id=p_reverse;
 else
  insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values(j,case when p_in then cash else payable end,p_amount,0,'Rickshaw pass-through'),(j,case when p_in then payable else cash end,0,p_amount,'Rickshaw pass-through');
 end if;
 perform public.assert_journal_entry_balanced(j);update public.journal_entries set status='POSTED' where id=j;return j;
end $$;

create function public.rickshaw_drivers(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_input jsonb default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.drivers%rowtype;
begin
 perform private.rickshaw_authorize(p_organization_id,p_branch_id,p_actor_user_id);
 if p_input is not null then
  insert into public.drivers(organization_id,branch_id,name,phone,plate_number) values(p_organization_id,p_branch_id,btrim(p_input->>'name'),coalesce(p_input->>'phone',''),coalesce(p_input->>'plate_number','')) returning * into r;return to_jsonb(r);
 end if;
 return coalesce((select jsonb_agg(to_jsonb(d) order by name,id) from public.drivers d where organization_id=p_organization_id and branch_id=p_branch_id),'[]');
end $$;
create function public.rickshaw_save_trip(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_input jsonb,p_id bigint default null,p_delete boolean default false,p_key text default null) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.rickshaw_trips%rowtype;original public.rickshaw_trips%rowtype;driver bigint;input jsonb;fingerprint text;invoice_customer bigint;j uuid;
begin
 perform private.rickshaw_authorize(p_organization_id,p_branch_id,p_actor_user_id);
 if p_id is not null then
  select * into original from public.rickshaw_trips where id=p_id and organization_id=p_organization_id and branch_id=p_branch_id;if not found then return null;end if;
 end if;
 input:=coalesce(to_jsonb(original),'{}')||p_input;
 driver:=(input->>'driver_id')::bigint;
 perform 1 from public.drivers where organization_id=p_organization_id and branch_id=p_branch_id and id in(driver,original.driver_id) order by id for update;
 if not exists(select 1 from public.drivers where id=driver and organization_id=p_organization_id and branch_id=p_branch_id and (is_active or p_delete)) then raise exception using errcode='23514',message='Choose an active driver in this branch';end if;
 if p_id is not null then
  select * into r from public.rickshaw_trips where id=p_id and organization_id=p_organization_id and branch_id=p_branch_id for update;
  if not found then return null;end if;
  if r.driver_id<>original.driver_id then raise exception using errcode='40001',message='Trip changed; refresh and retry';end if;
  if r.is_paid or r.paid_amount>0 then raise exception using errcode='23514',message='Paid or partially paid trips cannot be edited or deleted';end if;
  if r.journal_entry_id is null then raise exception using errcode='23514',message='Trip posting requires reconciliation';end if;
  perform private.rickshaw_journal(p_organization_id,p_branch_id,p_actor_user_id,r.date,'RICKSHAW_TRIP',r.id,'REVERSAL-'||r.revision,r.amount,true,r.journal_entry_id);
  if p_delete then delete from public.rickshaw_trips where id=p_id;return jsonb_build_object('id',p_id,'deleted',true);end if;
 end if;
 if nullif(input->>'customer_id','') is not null and not exists(select 1 from public.customers where id=(input->>'customer_id')::bigint and organization_id=p_organization_id) then raise exception using errcode='42501',message='Customer is outside this organization';end if;
 if nullif(input->>'invoice_id','') is not null then
  select customer_id into invoice_customer from public.invoices where id=(input->>'invoice_id')::bigint and organization_id=p_organization_id and branch_id=p_branch_id;
  if not found then raise exception using errcode='42501',message='Invoice is outside this branch';end if;
  if nullif(input->>'customer_id','') is not null and invoice_customer<>(input->>'customer_id')::bigint then raise exception using errcode='23514',message='Invoice customer does not match';end if;
  input:=input||jsonb_build_object('customer_id',invoice_customer);
 end if;
 if p_id is null then
  if coalesce(btrim(p_key),'')='' then raise exception using errcode='22023',message='Idempotency-Key is required';end if;
  fingerprint:=md5(input::text);
  select * into r from public.rickshaw_trips where organization_id=p_organization_id and branch_id=p_branch_id and idempotency_key=p_key;
  if found then if r.request_fingerprint<>fingerprint then raise exception using errcode='23514',message='Idempotency-Key was used for a different trip';end if;return to_jsonb(r);end if;
  insert into public.rickshaw_trips(organization_id,branch_id,date,driver_id,material,quantity,unit,rate_type,rate,customer_id,invoice_id,notes,idempotency_key,request_fingerprint)
  values(p_organization_id,p_branch_id,coalesce((input->>'date')::date,current_date),driver,input->>'material',(input->>'quantity')::numeric,input->>'unit',input->>'rate_type',(input->>'rate')::numeric,(input->>'customer_id')::bigint,(input->>'invoice_id')::bigint,coalesce(input->>'notes',''),p_key,fingerprint) returning * into r;
 else
  update public.rickshaw_trips set date=(input->>'date')::date,driver_id=driver,material=input->>'material',quantity=(input->>'quantity')::numeric,unit=input->>'unit',rate_type=input->>'rate_type',rate=(input->>'rate')::numeric,customer_id=(input->>'customer_id')::bigint,invoice_id=(input->>'invoice_id')::bigint,notes=coalesce(input->>'notes',''),revision=revision+1 where id=p_id returning * into r;
 end if;
 j:=private.rickshaw_journal(p_organization_id,p_branch_id,p_actor_user_id,r.date,'RICKSHAW_TRIP',r.id,case when p_id is null then 'PRIMARY' else 'AMENDMENT-'||r.revision end,r.amount,true);
 update public.rickshaw_trips set journal_entry_id=j where id=r.id returning * into r;return to_jsonb(r);
end $$;

create function public.rickshaw_pay_driver(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_input jsonb,p_key text) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.driver_payments%rowtype;t public.rickshaw_trips%rowtype;driver bigint:=(p_input->>'driver_id')::bigint;pay_date date:=coalesce((p_input->>'date')::date,current_date);value numeric:=(p_input->>'amount')::numeric;remaining numeric;allocated numeric;due numeric;j uuid;
begin
 perform private.rickshaw_authorize(p_organization_id,p_branch_id,p_actor_user_id);
 perform 1 from public.drivers where id=driver and organization_id=p_organization_id and branch_id=p_branch_id for update;if not found then raise exception using errcode='42501',message='Driver is outside this branch';end if;
 if coalesce(btrim(p_key),'')='' then raise exception using errcode='22023',message='Idempotency-Key is required';end if;
 select * into r from public.driver_payments where organization_id=p_organization_id and branch_id=p_branch_id and idempotency_key=p_key;
 if found then if r.request_fingerprint<>md5(p_input::text) then raise exception using errcode='23514',message='Idempotency-Key was used for a different payout';end if;return to_jsonb(r);end if;
 select coalesce(sum(amount-paid_amount),0) into due from public.rickshaw_trips where organization_id=p_organization_id and branch_id=p_branch_id and driver_id=driver and date<=pay_date;
 if value<=0 or value>due then raise exception using errcode='23514',message='Payout must be positive and cannot exceed the outstanding balance';end if;
 insert into public.driver_payments(organization_id,branch_id,driver_id,date,amount,payment_method,idempotency_key,request_fingerprint) values(p_organization_id,p_branch_id,driver,pay_date,value,coalesce(p_input->>'payment_method','CASH'),p_key,md5(p_input::text)) returning * into r;
 remaining:=value;
 for t in select * from public.rickshaw_trips where organization_id=p_organization_id and branch_id=p_branch_id and driver_id=driver and date<=pay_date and paid_amount<amount order by date,id for update loop
  allocated:=least(remaining,t.amount-t.paid_amount);
  insert into public.driver_payment_allocations(payment_id,trip_id,amount) values(r.id,t.id,allocated);
  update public.rickshaw_trips set paid_amount=paid_amount+allocated,is_paid=(paid_amount+allocated=amount) where id=t.id;
  remaining:=remaining-allocated;exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception using errcode='23514',message='Trip balance changed; refresh and retry';end if;
 j:=private.rickshaw_journal(p_organization_id,p_branch_id,p_actor_user_id,pay_date,'DRIVER_PAYMENT',r.id,'PRIMARY',value,false);
 update public.driver_payments set journal_entry_id=j where id=r.id returning * into r;return to_jsonb(r);
end $$;

create function public.rickshaw_register(p_organization_id uuid,p_branch_id uuid,p_actor_user_id uuid,p_date date default current_date,p_summary boolean default false) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb;
begin
 perform private.rickshaw_authorize(p_organization_id,p_branch_id,p_actor_user_id);
 if not p_summary then return coalesce((select jsonb_agg(to_jsonb(t) order by id desc) from public.rickshaw_trips t where organization_id=p_organization_id and branch_id=p_branch_id and date=p_date),'[]');end if;
 select coalesce(jsonb_agg(to_jsonb(s) order by name,driver_id),'[]') into rows from (
  select d.id driver_id,d.name,d.phone,d.plate_number,
   (select count(*) from public.rickshaw_trips t where t.driver_id=d.id and t.date=p_date) trips,
   coalesce((select jsonb_agg(to_jsonb(m) order by material,unit) from (select material,unit,sum(quantity) quantity,sum(amount) amount from public.rickshaw_trips t where t.driver_id=d.id and t.date=p_date group by material,unit) m),'[]') materials,
   coalesce((select sum(amount) from public.rickshaw_trips t where t.driver_id=d.id and t.date=p_date),0) owed,
   coalesce((select sum(amount) from public.driver_payments p where p.driver_id=d.id and p.date=p_date),0) paid,
   coalesce((select sum(amount) from public.rickshaw_trips t where t.driver_id=d.id and t.date<p_date),0)-coalesce((select sum(amount) from public.driver_payments p where p.driver_id=d.id and p.date<p_date),0) opening_balance,
   coalesce((select sum(amount) from public.rickshaw_trips t where t.driver_id=d.id and t.date<=p_date),0)-coalesce((select sum(amount) from public.driver_payments p where p.driver_id=d.id and p.date<=p_date),0) balance
  from public.drivers d where organization_id=p_organization_id and branch_id=p_branch_id and (is_active or exists(select 1 from public.rickshaw_trips where driver_id=d.id) or exists(select 1 from public.driver_payments where driver_id=d.id))
 ) s;
 return jsonb_build_object('date',p_date,'drivers',rows,'totals',(select jsonb_build_object('trips',coalesce(sum(trips),0),'owed',coalesce(sum(owed),0),'paid',coalesce(sum(paid),0),'opening_balance',coalesce(sum(opening_balance),0),'balance',coalesce(sum(balance),0)) from jsonb_to_recordset(rows) as t(trips bigint,owed numeric,paid numeric,opening_balance numeric,balance numeric)));
end $$;
revoke all on function private.rickshaw_authorize(uuid,uuid,uuid),private.rickshaw_journal(uuid,uuid,uuid,date,text,bigint,text,numeric,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.rickshaw_drivers(uuid,uuid,uuid,jsonb),public.rickshaw_save_trip(uuid,uuid,uuid,jsonb,bigint,boolean,text),public.rickshaw_pay_driver(uuid,uuid,uuid,jsonb,text),public.rickshaw_register(uuid,uuid,uuid,date,boolean) from public,anon,authenticated;
grant execute on function public.rickshaw_drivers(uuid,uuid,uuid,jsonb),public.rickshaw_save_trip(uuid,uuid,uuid,jsonb,bigint,boolean,text),public.rickshaw_pay_driver(uuid,uuid,uuid,jsonb,text),public.rickshaw_register(uuid,uuid,uuid,date,boolean) to service_role;
commit;
