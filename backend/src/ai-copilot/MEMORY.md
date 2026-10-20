# Institutional memory

Apply `supabase/migrations/20261020120000_copilot_institutional_memory.sql`
before releasing this backend. It introduces the commercial-history projection,
merchant baselines, confirmed-slip dictionary and exact historical net returns.
No customer, merchant, invoice or product fixtures are inserted by the migration.

`CustomerMemoryStore` reads persisted estimates and posted invoices within the
authenticated organization and branch. It recalls preferred brands per category,
dated discounts, order frequency and average document value. Converted estimates
are excluded when their posted invoice exists. Voided invoices never authorize a
return. There is no process-local customer memory to lose on restart or replay.

Both unified quotes and conversational estimates prefill compatible historical
discounts. Explicit customer choices take precedence. Rates always come from the
current authorized sale rate list. Missing or ambiguous brand/size matches still
require clarification. Historical discounts never override a merchant floor.

The floor is the highest verified applicable product purchase cost, most recent
purchase transaction cost, active purchase rate, effective wholesale baseline,
and (for invoices) reviewed inventory valuation. Unknown costs fail closed.
Purchase records are currently PKR; other currencies need an applicable purchase
rate or explicit baseline. To maintain a merchant ceiling, an authorized backend
administrator writes `copilot_purchase_baselines` with organization, brand,
category, unit, currency, wholesale discount and effective interval. A 42% ceiling
means a net floor of 58% of the matching list price. Browser roles cannot write it.

`erp_customer_return` binds a customer/product to the latest posted invoice line,
or a user-selected source invoice. It never accepts a price. Confirmation checks
the approved source again; it cannot switch to a later sale. The existing atomic
return RPC retains quantity limits, stock restoration, idempotency and accounting.
New Copilot invoices preserve each line's actual discount amount and percentage.
Legacy invoices with only a header discount use its proportional billed net rate;
already-net invoice lines are not discounted twice. The Urdu preview uses future
tense; the credit confirmation appears only after independent ERP verification.

`SlipLearningStore` keeps reviewed shorthand, canonical product name, size, unit
and usage count in PostgreSQL. Image/camera estimate and invoice confirmations
teach only after independent ERP verification. An action-keyed learning event
makes retries atomic and prevents duplicate counts. Failed OCR, unconfirmed
extraction, rejected actions and ordinary text transactions teach nothing.
The next vision extraction receives up to 30 frequent organization-scoped examples
as quoted, untrusted data. The existing configured vision provider/model is kept;
no fine-tuning, image retention or model-version downgrade is introduced.

Run `npm run check` and `npm run test:database` from `backend/`. The SQL regression
uses disposable embedded PostgreSQL and rolls back all business fixtures. The
production build workflow also executes the memory SQL regression on PostgreSQL 17.
