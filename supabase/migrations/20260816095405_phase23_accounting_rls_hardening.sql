alter table public.accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.journal_entries from anon, authenticated;
revoke all on table public.journal_lines from anon, authenticated;