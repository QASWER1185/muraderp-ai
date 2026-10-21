-- Restore the approved profile-write RPC used by the Copilot operations layer.
-- Calls are backend-only; authorization, branch scope, and idempotency are
-- checked again inside the transaction before any customer/profile mutation.
create function public.commit_copilot_profile_action(
  p_organization_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_service_principal text,
  p_idempotency_key text,
  p_tool text,
  p_payload jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_permission text;
  v_operation text;
  v_fingerprint text := md5(coalesce(p_payload::text,''));
  v_previous public.depot_action_receipts%rowtype;
  v_result jsonb;
  v_customer_id bigint;
  v_customer public.customers%rowtype;
  v_updates jsonb;
  v_opening_balance numeric;
  v_credit_limit numeric;
  v_journal_id uuid;
  v_ar_account uuid;
  v_equity_account uuid;
  v_payment_id bigint;
  v_payment_fingerprint text;
  v_cash_account uuid;
  v_payment_method text;
  v_amount numeric;
  v_payment_date date;
begin
  if p_tool not in ('erp_create_customer','erp_update_customer','erp_update_product_price','erp_record_payment') then
    raise exception using errcode='22023',message='Unsupported Copilot profile action';
  end if;
  if nullif(btrim(p_service_principal),'') is null
     or lower(btrim(p_service_principal)) in ('backend','default','internal-system','service-role','service_role','system')
     or nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>255
     or p_payload is null or jsonb_typeof(p_payload)<>'object' then
    raise exception using errcode='22023',message='Explicit principal, payload, and idempotency key are required';
  end if;

  v_permission := case p_tool
    when 'erp_create_customer' then 'customers.write'
    when 'erp_update_customer' then 'customers.write'
    when 'erp_update_product_price' then 'products.write'
    else 'payments.create'
  end;
  v_operation := case p_tool
    when 'erp_create_customer' then 'customer.create'
    when 'erp_update_customer' then 'customer.update'
    when 'erp_update_product_price' then 'product.price.update'
    else 'customer-payment.create'
  end;
  perform private.assert_authoritative_non_sales_context(
    p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,
    v_operation,v_operation,v_permission
  );

  perform pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array(p_organization_id,p_branch_id,p_actor_user_id,p_tool,p_idempotency_key)::text,0));
  select * into v_previous from public.depot_action_receipts
  where organization_id=p_organization_id and branch_id=p_branch_id and actor_user_id=p_actor_user_id
    and tool=p_tool and idempotency_key=p_idempotency_key;
  if found then
    if v_previous.fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='Copilot profile action idempotency conflict';
    end if;
    return v_previous.result;
  end if;

  if p_tool='erp_create_customer' then
    if nullif(btrim(p_payload->>'name'),'') is null or length(p_payload->>'name')>200
       or p_payload->>'phone' is null or length(p_payload->>'phone')>50
       or nullif(btrim(p_payload->>'address'),'') is null or length(p_payload->>'address')>200 then
      raise exception using errcode='22023',message='Customer name, phone, and address are required';
    end if;
    v_opening_balance:=coalesce((p_payload->>'openingBalance')::numeric,0);
    v_credit_limit:=coalesce((p_payload->>'creditLimit')::numeric,0);
    if v_opening_balance<0 or v_opening_balance::text in ('NaN','Infinity','-Infinity')
       or v_credit_limit<0 or v_credit_limit::text in ('NaN','Infinity','-Infinity') then
      raise exception using errcode='22023',message='Invalid customer balance or credit limit';
    end if;
    if v_opening_balance>0 then
      perform private.assert_authoritative_non_sales_context(
        p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,
        'customer.create','customer.create','accounting.post');
    end if;
    if exists(select 1 from public.customers c where c.organization_id=p_organization_id
      and lower(btrim(c.name))=lower(btrim(p_payload->>'name'))
      and lower(btrim(c.city))=lower(btrim(p_payload->>'address'))) then
      raise exception using errcode='23505',message='Customer already exists in this organization';
    end if;
    insert into public.customers(organization_id,name,phone,city,credit_limit)
      values(p_organization_id,btrim(p_payload->>'name'),btrim(p_payload->>'phone'),btrim(p_payload->>'address'),v_credit_limit)
      returning id into v_customer_id;
    if v_opening_balance>0 then
      insert into public.customer_ledger_entries(
        organization_id,branch_id,customer_id,entry_type,reference_type,reference_id,
        debit,credit,currency_code,entry_date,description
      ) values(p_organization_id,p_branch_id,v_customer_id,'ADJUSTMENT','CUSTOMER_OPENING',v_customer_id,
        v_opening_balance,0,'PKR',current_date,'Copilot approved customer opening balance');
      select id into v_ar_account from public.accounts where code='1100' and is_active;
      select id into v_equity_account from public.accounts where code='3000' and is_active;
      if v_ar_account is null or v_equity_account is null then
        raise exception using errcode='23503',message='Opening balance accounts are not configured';
      end if;
      insert into public.journal_entries(
        organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,
        posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status
      ) values(p_organization_id,p_branch_id,p_actor_user_id,current_date,'Customer opening balance',
        'CUSTOMER_OPENING',v_customer_id::text,'PRIMARY',btrim(p_service_principal),
        'customer.create',p_idempotency_key,v_fingerprint,'DRAFT') returning id into v_journal_id;
      insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
        (v_journal_id,v_ar_account,v_opening_balance,0,'Customer opening receivable'),
        (v_journal_id,v_equity_account,0,v_opening_balance,'Opening balance equity');
      perform public.assert_journal_entry_balanced(v_journal_id);
      update public.journal_entries set status='POSTED' where id=v_journal_id;
    end if;
    v_result:=jsonb_build_object('id',v_customer_id,'status','CREATED');

  elsif p_tool='erp_update_customer' then
    v_customer_id:=(p_payload->>'customerId')::bigint;
    v_updates:=p_payload->'updates';
    if v_customer_id is null or jsonb_typeof(v_updates)<>'object' or v_updates='{}'::jsonb
       or (v_updates - array['name','phone','address','creditLimit'])<>'{}'::jsonb then
      raise exception using errcode='22023',message='Invalid customer update';
    end if;
    select * into strict v_customer from public.customers
      where id=v_customer_id and organization_id=p_organization_id for update;
    if p_payload ? 'before' and (
      (p_payload->'before'->>'name') is distinct from v_customer.name
      or (p_payload->'before'->>'phone') is distinct from v_customer.phone
      or (p_payload->'before'->>'city') is distinct from v_customer.city
      or coalesce((p_payload->'before'->>'credit_limit')::numeric,0) is distinct from v_customer.credit_limit
    ) then raise exception using errcode='40001',message='Customer changed after approval preview'; end if;
    if v_updates ? 'name' and nullif(btrim(v_updates->>'name'),'') is null then raise exception using errcode='22023',message='Customer name cannot be blank'; end if;
    if v_updates ? 'address' and nullif(btrim(v_updates->>'address'),'') is null then raise exception using errcode='22023',message='Customer address cannot be blank'; end if;
    if v_updates ? 'creditLimit' and ((v_updates->>'creditLimit')::numeric<0 or (v_updates->>'creditLimit')::numeric::text in ('NaN','Infinity','-Infinity')) then
      raise exception using errcode='22023',message='Invalid customer credit limit';
    end if;
    update public.customers set
      name=case when v_updates ? 'name' then btrim(v_updates->>'name') else name end,
      phone=case when v_updates ? 'phone' then btrim(v_updates->>'phone') else phone end,
      city=case when v_updates ? 'address' then btrim(v_updates->>'address') else city end,
      credit_limit=case when v_updates ? 'creditLimit' then (v_updates->>'creditLimit')::numeric else credit_limit end,
      updated_at=now()
      where id=v_customer_id and organization_id=p_organization_id;
    v_result:=jsonb_build_object('id',v_customer_id,'status','UPDATED');

  elsif p_tool='erp_update_product_price' then
    v_result:=public.commit_depot_action(
      p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,'erp_update_commodity_rates',
      jsonb_build_object('id',gen_random_uuid(),'reason',p_payload->>'reason','rates',jsonb_build_array(jsonb_build_object(
        'productId',p_payload->>'productId','rateListId',p_payload->'rate'->>'rate_list_id',
        'versionId',p_payload->'rate'->>'rate_list_version_id','minimumQuantity',p_payload->'rate'->>'minimum_quantity',
        'before',p_payload->'rate'->>'unit_price','newPrice',p_payload->>'newPrice'))),p_idempotency_key
    );

  else
    if jsonb_typeof(coalesce(p_payload->'allocations','[]'::jsonb))<>'array'
       or jsonb_array_length(coalesce(p_payload->'allocations','[]'::jsonb))<>0 then
      raise exception using errcode='22023',message='Only unallocated customer payments use the profile action RPC';
    end if;
    perform private.assert_authoritative_non_sales_context(
      p_organization_id,p_branch_id,p_actor_user_id,p_service_principal,
      'customer-payment.create','customer-payment.create','payments.create');
    v_customer_id:=(p_payload->>'customerId')::bigint;
    v_amount:=(p_payload->>'amount')::numeric;
    v_payment_method:=p_payload->>'paymentMethod';
    v_payment_date:=coalesce((p_payload->>'paymentDate')::date,current_date);
    if v_amount is null or v_amount<=0 or v_amount::text in ('NaN','Infinity','-Infinity')
       or v_payment_method not in ('CASH','BANK_TRANSFER','CARD','CHEQUE','OTHER')
       or not exists(select 1 from public.customers where id=v_customer_id and organization_id=p_organization_id) then
      raise exception using errcode='22023',message='Invalid unallocated customer payment';
    end if;
    v_payment_fingerprint:=repeat(v_fingerprint,2);
    select id into v_cash_account from public.accounts where code=case v_payment_method when 'CASH' then '1000' when 'OTHER' then '1090' else '1010' end and is_active;
    select id into v_ar_account from public.accounts where code='1100' and is_active;
    if v_cash_account is null or v_ar_account is null then raise exception using errcode='23503',message='Payment accounts are not configured'; end if;
    insert into public.customer_payment_idempotency_keys(
      organization_id,branch_id,actor_user_id,principal_scope,operation,idempotency_key,request_fingerprint
    ) values(p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),'customer-payment.create',p_idempotency_key,v_payment_fingerprint);
    insert into public.customer_payments(
      organization_id,branch_id,actor_user_id,service_principal,operation_scope,customer_id,payment_date,
      amount,currency_code,payment_method,reference_number,notes
    ) values(p_organization_id,p_branch_id,p_actor_user_id,btrim(p_service_principal),'customer-payment.create',
      v_customer_id,v_payment_date,v_amount,'PKR',v_payment_method,nullif(btrim(p_payload->>'reference'),''),
      nullif(btrim(p_payload->>'notes'),'')) returning id into v_payment_id;
    insert into public.customer_ledger_entries(
      organization_id,branch_id,customer_id,entry_type,reference_type,reference_id,debit,credit,currency_code,entry_date,description
    ) values(p_organization_id,p_branch_id,v_customer_id,'PAYMENT','CUSTOMER_PAYMENT',v_payment_id,0,v_amount,'PKR',v_payment_date,
      coalesce(nullif(btrim(p_payload->>'notes'),''),'Unallocated customer advance'));
    insert into public.journal_entries(
      organization_id,branch_id,actor_user_id,entry_date,description,source_type,source_record_id,
      posting_kind,principal_scope,operation_scope,idempotency_key,request_fingerprint,status
    ) values(p_organization_id,p_branch_id,p_actor_user_id,v_payment_date,'Customer unallocated payment',
      'CUSTOMER_PAYMENT',v_payment_id::text,'PRIMARY',btrim(p_service_principal),'customer-payment.create',
      p_idempotency_key,v_payment_fingerprint,'DRAFT') returning id into v_journal_id;
    insert into public.journal_lines(journal_entry_id,account_id,debit,credit,memo) values
      (v_journal_id,v_cash_account,v_amount,0,'Customer payment received'),
      (v_journal_id,v_ar_account,0,v_amount,'Customer receivable settled');
    perform public.assert_journal_entry_balanced(v_journal_id);
    update public.journal_entries set status='POSTED' where id=v_journal_id;
    update public.customer_payment_idempotency_keys set payment_id=v_payment_id,journal_entry_id=v_journal_id
      where organization_id=p_organization_id and principal_scope=btrim(p_service_principal)
        and operation='customer-payment.create' and idempotency_key=p_idempotency_key;
    v_result:=jsonb_build_object('id',v_payment_id,'status','POSTED','customer_id',v_customer_id,'amount',v_amount);
  end if;

  insert into public.depot_action_receipts(organization_id,branch_id,actor_user_id,tool,idempotency_key,fingerprint,result)
    values(p_organization_id,p_branch_id,p_actor_user_id,p_tool,p_idempotency_key,v_fingerprint,v_result);
  return v_result;
end;
$$;
alter function public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb) owner to postgres;
revoke all on function public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_copilot_profile_action(uuid,uuid,uuid,text,text,text,jsonb) to service_role;
notify pgrst, 'reload schema';
