# STEP 6 — P0-3 Existing-Data Ownership Gate

## Decision

Existing rows must never receive organization or branch ownership by inference. The only acceptable ownership source for real business data is explicit, verified owner evidence. Rows created for Postman/application validation remain unowned validation data until a separately approved cleanup unit.

## Read-only live evidence — 2026-08-29

Project: `pmsowmiivjkwtovynhje`.

- `auth.users`: 0
- `organizations`: 0
- `organization_memberships`: 0
- `customers`: 0
- `vendors`: 1 (`id=3`)
- `products`: 1 (`id=2`)
- `warehouses`: 1 (`id=2`)
- `inventory`: 1 (`id=2`)
- `stock_movements`: 1 (`id=2`)
- purchases, purchase items, invoices, invoice items, customer payments, vendor payments, journal entries and AI copilot actions: 0
- `accounts`: 10
- `permissions`: 20
- `role_permissions`: 88

The Principal Architect explicitly confirmed that the surviving vendor/product/warehouse/inventory/stock-movement records were inserted during Postman/application validation to test CRUD, inventory movement, decrement/increment, deletion and transaction behavior. They are therefore classified `TEST_VALIDATION`, not business history.

The accounting chart (`accounts`) and authorization catalogs (`permissions`, `role_permissions`) are migration-seeded system/template data. They are not customer business ownership rows and must not be assigned to a tenant merely because they are non-empty.

## Ownership-column finding

The live core business tables above do not currently carry reliable organization or branch ownership. `organization_id` exists in the Phase 10 membership model and AI audit table, but the surviving core ERP test rows do not have explicit tenant ownership. No `branch_id` exists in the live public schema.

## Phase 10 / Phase 21 boundary

Canonical Phase 10 remains the organization identity foundation: membership is organization-wide and keyed by `(organization_id, user_id)`. Phase 21 is `HISTORICAL_ONLY_DO_NOT_APPLY`; its null-branch wildcard semantics are deprecated. Branch access must be explicit through the separately approved branch foundation and must never be inferred from a null branch.

## Gate rules

1. `TEST_VALIDATION`: preserve unowned; no backfill; no automatic deletion.
2. `UNKNOWN_REQUIRES_OWNER_DECISION`: block any ownership migration until an explicit owner decision exists.
3. `REAL_BUSINESS_EXPLICITLY_PROVEN`: requires an explicit organization UUID and evidence. Branch ownership, when required, must also be explicit.
4. `SYSTEM_TEMPLATE`: migration-seeded platform/reference data; exclude from customer business ownership inference.
5. Default organization assignment is forbidden.
6. Synthetic branch assignment is forbidden.
7. Automatic cleanup is forbidden.
8. A fresh read-only live snapshot is mandatory before any future ownership migration because new rows created after this capture are unknown by default.

## Implementation

Repository control is implemented by:

- `supabase/data-ownership/p0-3-existing-data-classification.json`
- `scripts/validate-existing-data-ownership.mjs`
- `scripts/p0-3-existing-data-ownership-snapshot.sql`
- Stage 11 release-readiness invocation of the ownership validator.

The validator is intentionally fail-closed. Unknown rows in the manifest fail validation. Real-business rows fail unless they have explicit organization ownership evidence. Test rows fail if an organization or branch is assigned to them.

## Migration decision

No migration is created in P0-3. A schema migration would not establish factual ownership and would add production surface without resolving the evidence problem. P0-3 is therefore implemented as a repository-enforced classification and pre-migration gate. No production schema or data change is authorized by this unit.

## Forward rule

Before a future tenant ownership migration is authored or applied:

1. rerun the read-only snapshot;
2. compare live non-empty business rows with the manifest;
3. classify every new row explicitly;
4. stop on any unknown row;
5. never infer an organization/branch from names, timestamps, foreign keys, or convenience defaults.

P0-1R authoritative validator execution remains a separate infrastructure blocker and does not change this P0-3 decision.
