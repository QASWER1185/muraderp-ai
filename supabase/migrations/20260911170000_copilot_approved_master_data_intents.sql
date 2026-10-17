alter table public.ai_copilot_actions
  drop constraint if exists ai_copilot_actions_intent_check;

alter table public.ai_copilot_actions
  add constraint ai_copilot_actions_intent_check
  check (intent in (
    'estimate',
    'invoice',
    'customer_return',
    'supplier_bill',
    'inventory_adjustment',
    'customer_create',
    'vendor_create',
    'rate_list_update',
    'customer_payment',
    'vendor_payment'
  ));

comment on constraint ai_copilot_actions_intent_check on public.ai_copilot_actions is
  'Allowed persisted Copilot action records. Invoice remains present only for historical compatibility; current Copilot routes and runtime reject new or confirmed Invoice actions.';
