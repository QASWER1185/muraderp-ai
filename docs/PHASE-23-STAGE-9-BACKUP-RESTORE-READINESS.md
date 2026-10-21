# Phase 23 — Stage 9: Backup / Restore / Database Recovery Readiness

## Purpose

Establish an evidence-driven recovery boundary for the MuradERP-AI database without changing production business data or weakening the application's transactional guarantees.

## Verified production schema baseline

Supabase project: `pmsowmiivjkwtovynhje`

Verified critical public relations:

- `accounts`
- `journal_entries`
- `journal_lines`
- `general_ledger`
- `trial_balance`
- `vendors`
- `purchases`
- `purchase_items`
- `invoices`
- `customer_payments`
- `vendor_payments`
- `inventory`

Verified migration ledger count: **22** migrations.

The authoritative migration history must remain the source of truth for schema reconstruction.

## Recovery procedure

1. Freeze application writes for the declared recovery window.
2. Identify the target recovery timestamp and the corresponding application/migration revision.
3. Restore the database backup/snapshot into an isolated recovery environment; never restore destructively over the production database as a first test.
4. Apply the repository migration set through the target revision only when the backup is intentionally a schema reconstruction test.
5. Verify critical relations, constraints, RLS/security posture, indexes, functions/RPCs, and migration ledger.
6. Run the repository's database/runtime smoke tests and accounting/transaction integrity tests.
7. Compare row counts and critical business invariants where a known-good reference dataset exists.
8. Record recovery start/end time, restore target, migration revision, verification result, and unresolved discrepancies.
9. Only after the isolated restore passes should an operator consider a controlled production recovery.

## Failure boundaries

- Do not execute destructive restore commands against production as part of an automated CI job.
- Do not reset or recreate the production Supabase project.
- Do not bypass RLS, authorization, idempotency, or accounting controls during recovery verification.
- A successful schema migration is not equivalent to a successful data restore.
- A successful backup is not considered proven recoverable until an isolated restore has been exercised.

## Evidence currently available

- Repository migration history is versioned in Git.
- Supabase reports 22 applied migrations.
- Critical ERP/accounting relations are present in the live project.
- Stage 8 is already closed before this Stage 9 work begins.

## Remaining proof required for FINAL/CLOSED

The connected tooling available to this engineering session does not expose a destructive-safe production backup download/restore execution endpoint. Therefore an actual isolated backup restore cannot honestly be marked as verified from this session alone.

Stage 9 must remain **IN VERIFICATION** until an authorized recovery environment can perform and evidence an actual backup/snapshot restore, followed by the verification sequence above.

## Locked acceptance rule

Stage 9 may be marked **100% FINAL/CLOSED** only after:

- recovery procedure documented;
- repository migration baseline verified;
- live schema baseline verified;
- an actual isolated backup/snapshot restore is executed;
- post-restore schema/security/integrity checks pass;
- required CI gates pass;
- PR is merged into `develop`;
- exact merge SHA is verified;
- post-merge `develop` required CI is GREEN.

CI-green alone is never sufficient for Stage 9 acceptance.
