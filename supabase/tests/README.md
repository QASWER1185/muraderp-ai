# Database regression tests

Run `npm ci --prefix backend` and `npm run test:database --prefix backend`
for a disposable, in-memory PostgreSQL replay without Docker or database volumes.
The runner reports its actual engine version; this is a supplemental local check,
not evidence of PostgreSQL 17.6 compatibility.

The production cloud workflow runs these same five scripts with `ON_ERROR_STOP`
against a fresh `postgres:17.6` service after applying every canonical migration:

- `database_foundation.sql`
- `accounting_ledger_foundation_v2.sql`
- `p0_8_authoritative_accounting_posting.sql`
- `products_final_gate.sql`
- `estimate_conversion.sql`

Every script uses synthetic tenant fixtures and rolls back its changes.
`accounting_ledger_foundation.sql` is a psql compatibility entry point for v2.
The accounting smoke test calls `post_invoice_atomic`, the authoritative posting
RPC used by the backend sales transaction repository, under `service_role`.

`scripts/database-test-bootstrap.sql` is only for a fresh disposable database.
It supplies Supabase auth stubs and default service-role privileges before the
migrations run, so migration-specific privilege revocations remain effective.
Never apply this bootstrap to an existing local or hosted database.
