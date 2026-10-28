# Copilot v2 branch handoff

This branch is isolated for user acceptance. Do not merge it or deploy its backend/frontend to production before the owner tests and approves it.

## Preserved baseline

- Original `main`: `503c0f7` (left unchanged).
- Current deployed source snapshot: `96f89d4`, preserved on local branch `backup/copilot-v2-baseline-20261028` and tag `copilot-v2-baseline-20261028`.
- The snapshot includes earlier production fixes that had not yet reached GitHub main. Its commit is a preservation step, separate from the v2 refactor.
- Dashboard source, stylesheet, `copilot.service.ts` and the estimate calculator have no changes relative to that snapshot.
- No production migration, estimate mutation or financial posting was performed for this refactor. Protected production estimate records were read through GET only; their before/after record hashes are retained outside Git in the task workspace. Live business amounts are intentionally excluded from this handoff file.
- EST-1064's amount in the task is inconsistent with the existing live record. Preserve the actual saved value; do not rewrite it to match the task text. The task's alternative amount was associated with cancelled EST-1063 in earlier verification.

## Active architecture

The frontend uses `POST /api/v1/ai/copilot/v2/chat`. Standard chat/agent/input aliases also enter v2 in the normal application. Explicitly injected legacy test agents retain their compatibility path. Previous regex-driven agents and extraction routes remain available as rollback/compatibility source; they do not select intent for the v2 chat.

Gemini reads the current request and chooses native functions. Image and PDF bytes go directly to Gemini, without the legacy slip intent/OCR traps. Dedicated voice input is transcribed by Gemini and enters the same reasoning loop. Audio attached as document evidence is read as untrusted observations and cannot supply approval or memory verification. Native reasoning signatures survive tool-result turns. Native-only v2 does not retry provider failures by interpreting prose JSON as executable tool calls. Provider credentials and media bytes are not saved in chat history or shop memory.

The connector retains authorization, scope, input validation, live price resolution, native estimate calculations, accounting rules and ERP execution verification. These are the ERP data boundary. It does not regex-classify greetings, record references or conversational approvals. The model interprets approval, while the server binds execution to a scoped, immutable previous-turn preview, exact current-user evidence, expiry and runtime idempotency. A revised financial preview invalidates the preceding approval capability. Explicit current-user direct instructions can execute nonfinancial estimate/profile/catalog work in the same turn after preparation; financial posting still requires a prior-turn preview.

## Tools

- `manage_estimate`: create preview, read saved records, revise pending previews, edit saved native estimate fields/lines with optimistic `updated_at`, and prepare cancellation. Cancellation is identified honestly rather than claiming hard deletion. Owner rate overrides require quoted user provenance; otherwise new prices must match an active catalog rate.
- `manage_invoice`: create invoice, convert estimate, prepare a return at historical rates, read an invoice, or revise an unconfirmed preview. Posted invoice mutation/deletion is not implemented by the native ERP; the agent offers a return/credit instead.
- `record_financial_transaction`: customer receipt, vendor payment, salary and expense previews through existing services. Allocations/accounts are explicit. Direct bank-to-bank transfer has no authoritative endpoint and returns an Urdu capability limit.
- `manage_inventory_and_rates`: authoritative rate/stock reads, product creation with a unique catalog SKU and no invented active price, and rate-list import previews. Costed stock adjustment is unavailable in the native engine and is reported as such.
- `manage_party`: customer and vendor creation, profile updates, customer ledger, and vendor profile/open payables. Vendor payables are explicitly not presented as a complete vendor ledger.
- `manage_shop_memory`: retrieve/save/update/delete user-verified shorthand, brand rules and customer preferences. Evidence must be a verbatim current-user quote. Corrections upsert the same scoped category/key. Example discounts in the task are not seeded as facts.
- `read_erp`: additional authorized read-only search/report capabilities already registered by the ERP. Its allow-list cannot execute write tools.
- `execute_prepared_action`: execute the previous exact preview after the user's current approval. Financial same-turn previews cannot approve themselves. Explicit direct nonfinancial work needs exact current-user evidence; incomplete prices cannot be posted.

Unsupported endpoints return `supported:false`, `executed:false` with a human Urdu explanation. No tool fabricates completion. New catalog creation does not create an active rate list automatically. Catalog product names and persisted descriptions should be supplied in English; real party names are retained as provided.

## Persistence

Branch migration: `supabase/migrations/20261028090000_copilot_v2_memory_conversations.sql`.

- `copilot_memories`: organization/branch/category/key uniqueness; value, verifying actor and source quote. Correction replaces the active fact immediately.
- `copilot_v2_conversations`: actor and tenant scoped messages, active state, immutable pending preview, version, verified execution receipts and lease. Optimistic claim/save prevents concurrent turns from mutating the same conversation.
- RLS is enabled; browser roles have no direct table privileges. Only server connectors access these tables after membership/branch checks. A database trigger rejects a branch from another organization.
- Browser transcript storage is scoped by user/organization/branch and restores inert text only, never old executable confirmation cards. Conversation IDs survive navigation/reload and resume durable server context even when an old short-lived client token expires. Explicit reset clears the active local transcript.

Do not run this migration against the linked production project. It has only been exercised in disposable in-memory PostgreSQL for this task.

## Run and test locally

1. `git switch copilot-v2`
2. `npm ci --prefix backend` and `npm ci --prefix frontend`.
3. Use a separate Supabase development project, with its own users, memberships and branch grants. Restore an authorized test fixture/backup there and apply repository migrations, including the v2 migration, to that **development database only**. Do not use production credentials or `supabase db push --linked` against the existing production link.
4. In the backend terminal set `NODE_ENV=development`, `PORT=3000`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to that development project's URL and `sb_secret_...` key. Supply a development `INTERNAL_API_TOKEN` (32+ characters) and `INTERNAL_API_PRINCIPAL_ID` if using service API clients. Set `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and the enabled `GEMINI_MODEL`; alternatively supply the browser Gemini key in Copilot settings.
5. Run `npm run dev --prefix backend`.
6. In another terminal set `BACKEND_URL=http://127.0.0.1:3000`, `NEXT_PUBLIC_SUPABASE_URL` to that development project URL, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) to its public key. Run `npm run dev --prefix frontend`, open `http://127.0.0.1:3001`, and sign in as the development user. The branch dev server defaults to localhost and refuses to serve the hosted auth fallback without explicit development public configuration. Never put an sb_secret_ key in a NEXT_PUBLIC variable.
7. Test chat text, recorded Urdu speech and slip images through Copilot. Do not manually alter estimate DB rows as an acceptance test. Create test estimates through chat and approve only disposable development records.

Targeted checks (no full ERP suite):

```powershell
npm run build --prefix backend
npm run build --prefix frontend
cd backend
npx vitest run src/ai-copilot/v2/agent.test.ts src/ai-copilot/v2/native-provider.test.ts src/ai-copilot/v2/store.test.ts src/ai-copilot/v2/preferences.test.ts src/routes/copilot-v2.routes.test.ts --maxWorkers=2
cd ../frontend
npx vitest run copilot-history.test.js copilot-api.test.js copilot-multimodal.test.js copilot-stateful.test.js --maxWorkers=2
```

Acceptance examples:

- Ask for an ambiguous slip: all unreadable rows must be clarified together; no missing rows or invented prices.
- Supply a hardware rate on the next turn: it must update the pending preview and recalculate through ERP.
- Prepare an invoice/payment, inspect totals, then say `جی منظور ہے` on the next turn. The native service must execute only that preview. A correction must require approval of its replacement.
- Ask to remember a confirmed shorthand, correct the same fact, reload/navigate, and ask again. Old wrong memory must not reappear.
- Test another user/branch: neither transcript nor actions may cross the scope.
- In the development copy, compare EST-1067, EST-1065, EST-1064 and EST-1062 before/after using read tools. Preserve actual saved records rather than forcing task example values.

## Deployment isolation

`copilot-v2` automatic deployments are disabled in both Vercel config locations using the documented [`git.deploymentEnabled` branch setting](https://vercel.com/docs/project-configuration/git-configuration). Production build workflows do not match this branch. No production deploy command was run. The owner must approve regression results before any merge or production rollout.

The real Gemini native transport was smoke-tested with a fictitious missing SKU and an in-memory ERP connector: it called the stock tool and responded in Urdu without inventing zero stock. This is provider/schema integration validation, not a claim that production financial mutations were tested.

V2 disables the legacy automatic historical rate fallback, inferred customer discounts and hardcoded catalog-price baselines. Active pricing and explicitly supplied verified preferences remain authoritative; unknown items retain pending rows. If Gemini loses its connection after a successful write, the verified ERP receipt remains in the conversation and the response identifies the completed action rather than asking the owner to repeat it.
