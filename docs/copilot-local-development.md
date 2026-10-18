# Copilot navigation and entity regression

The sidebar routes Customers, Stock, Estimates and Invoices to their mounted
pages. Hash links such as `/#/customers` restore the selected view on reload;
Back and Forward restore the view as well. Each mount has a separate content
container so old page listeners and asynchronous renders cannot affect it.

The browser calls `POST /api/v1/ai/copilot/agent`; `/chat` uses the same agent.
`query_inventory` and `query_customer_ledger` resolve their entity queries
independently. A missing entity produces a verified not-found answer, while
other independent reads can continue. Customer suggestions require
`customers.read`, contain at most five names, and belong to the authorized
organization. An unavailable customer list is distinct from an empty list.
Missing entities never imply zero stock or a zero ledger balance.

## Local baseline

`supabase/seed.sql` runs during a local `supabase db reset --local`. It creates
the synthetic organization `copilot-local-demo` with these references:

- Organization: `d3000000-0000-4000-8000-000000000001`
- Branch: `d3000000-0000-4000-8000-000000000002`
- Customer: Hamdan Sahib, with one posted invoice and PKR 1,500 outstanding.
- Product: Bestway Cement, with a recorded stock quantity of zero bags.
- Product: Popular UPVC Pipe 4", with 19 pieces after the sample invoice.

The seed posts the sample invoice through `post_invoice_atomic`. Its stable
idempotency key prevents repeat runs from duplicating stock movements or
ledger entries. The posting actor has no login credentials. For browser testing,
use a local authenticated user granted membership and branch access to this
demo workspace, then choose it in the workspace picker. The backend also needs
a configured AI provider, model and API key for live natural-language requests.

## Verification

The backend loads environment files relative to its own location, including
compiled `dist` startup. Precedence (highest first) is the shell environment,
`backend/.env.local`, root `.env.local`, `backend/.env`, then root `.env`.
Node's built-in environment-file parser is used; files and secret values are
never logged. Tests do not automatically load real project environment files.

Keep the Supabase configuration and the existing `INTERNAL_API_TOKEN` in an
ignored root `.env.local` to preserve browser sessions across backend restarts.
Without a token, development can sign new sessions with an in-memory random
secret after verifying the user with Supabase. Those development sessions expire
on restart, and this secret never grants internal service access. Production
still requires the complete explicit ERP configuration.

`GEMINI_MODEL` selects the model used with a browser-supplied Gemini key,
independently of a Groq/OpenAI server provider. The default is the documented
stable `gemini-3.8-flash`; an unavailable model returns `AI_MODEL_UNAVAILABLE`.
The service does not silently switch providers or retry another billable model.

In Copilot's API key settings, **Test saved key** sends a minimal text request
through the authenticated backend and shows the upstream HTTP status on success.
It does not invoke ERP tools or write business data. Saving a key alone does not
verify provider access; invalid keys, unavailable models, and request errors are
reported separately.

```sh
cd frontend
npm test -- --maxWorkers=1
npm run typecheck
npm run build
cd ../backend
npm run typecheck
npm test -- --maxWorkers=1
npm run build
npm run test:database
```

The database runner applies all migrations to disposable embedded PostgreSQL,
runs the seed twice, and checks the single invoice, ledger debit and stock
quantities. The agent and HTTP tests use a scripted provider to cover missing
entities, partial results, permissions and provider failures without live keys.
