-- Phase 8 accounting foundation smoke test.
-- Runs inside a transaction and rolls back all fixtures.
begin;

declare
  v_cash uuid;
  v_sales uuid;
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
begin
  select id into v_cash from public.accounts where code = '1000';
  select id into v_sales from public.accounts where code = '4000';

  if v_cash is null or v_sales is null then
    raise exception 'seed chart of accounts missing';
  end if;

  v_entry := public.post_journal_entry(
    current_date,
    'Phase 8 smoke test',
    'TEST',
    gen_random_uuid(),
    'phase8-smoke-' || gen_random_uuid()::text,
    jsonb_build_array(
      jsonb_build_object('account_id', v_cash::text, 'debit', 100.00, 'credit', 0),
      jsonb_build_object('account_id', v_sales::text, 'debit', 0, 'credit', 100.00)
    )
  );

  select coalesce(sum(debit),0), coalesce(sum(credit),0)
    into v_debit, v_credit
  from public.journal_lines where journal_entry_id = v_entry;

  if v_debit <> 100 or v_credit <> 100 then
    raise exception 'journal did not balance: debit %, credit %', v_debit, v_credit;
  end if;

  if not exists (select 1 from public.trial_balance where account_id = v_cash and total_debit >= 100) then
    raise exception 'trial balance projection missing posted debit';
  end if;

  begin
    perform public.post_journal_entry(
      current_date,
      'Unbalanced smoke test',
      'TEST_UNBALANCED',
      gen_random_uuid(),
      'phase8-unbalanced-' || gen_random_uuid()::text,
      jsonb_build_array(
        jsonb_build_object('account_id', v_cash::text, 'debit', 50.00, 'credit', 0),
        jsonb_build_object('account_id', v_sales::text, 'debit', 0, 'credit', 40.00)
      )
    );
    raise exception 'unbalanced journal was accepted';
  exception when others then
    if position('journal entry must be balanced' in sqlerrm) = 0 then
      raise;
    end if;
  end;
end;

rollback;
