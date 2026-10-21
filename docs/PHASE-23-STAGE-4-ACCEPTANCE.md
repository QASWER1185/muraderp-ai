# MURADERP-AI — PHASE 23 — STAGE 4 ACCEPTANCE

## Stage
Stage 4 — Idempotency / Duplicate Protection / Auditability

## Status
PASS — evidence verified

## Scope
Verify the existing protected purchase mutation contract. This stage does not introduce a parallel transaction engine or new product feature.

## Verified Application Contract
- `POST /api/v1/purchases` requires `Idempotency-Key` before persistence.
- The route derives a deterministic SHA-256 request fingerprint from normalized purchase input.
- The authenticated/internal principal scope, operation, idempotency key and fingerprint are passed to the authoritative `record_purchase` database function.
- The service reconstructs the authoritative purchase response returned by the database function.

## Verified Database Contract
The production Supabase project contains `public.purchase_idempotency_keys` and the authoritative `public.record_purchase` function.

Verified database protections:
- unique `(principal_scope, operation, idempotency_key)` index;
- unique `purchase_id` index for completed idempotency records;
- `expires_at` index;
- supplier invoice uniqueness on `(vendor_id, normalized invoice number)`;
- RLS policy denies `anon` and `authenticated` access to the idempotency table;
- protected purchase mutation is executed through the authoritative database function.

## Transactional Evidence
Read/write verification was executed inside explicit database transactions and rolled back after verification; no permanent business data was created.

### Evidence A — Same-key replay
A purchase was recorded with one idempotency key and the same request was submitted again with the same fingerprint.

Observed within the transaction:
- one purchase row;
- one idempotency-key row;
- idempotency status `COMPLETED`;
- second execution returned the stored response path rather than creating a second purchase.

### Evidence B — Same-key / different-request rejection
A completed idempotency key was reused with a different request fingerprint.

Observed within the transaction:
- original purchase remained the only purchase;
- stored fingerprint remained the original fingerprint;
- the conflicting reuse raised the database `P0001` idempotency-key-reuse condition;
- the idempotency record remained `COMPLETED` with its original audit metadata.

## Auditability
The idempotency record retains:
- principal scope;
- operation;
- idempotency key;
- request fingerprint;
- processing/completed status;
- purchase reference;
- response status/body;
- creation/completion timestamps;
- expiration timestamp.

This provides the required audit metadata for successful and rejected protected idempotency actions without exposing the table to browser roles.

## Safety
No production business data from the verification was retained. Verification transactions were rolled back.

## Acceptance Decision
Stage 4 requirements are satisfied by the existing authoritative purchase transaction boundary and verified database/application behavior.

The stage is eligible for final closure only after the mandatory Git release gate is completed:
1. PR CI green;
2. PR merged into `develop`;
3. exact merge SHA recorded;
4. `develop` HEAD equals that merge SHA;
5. exact post-merge `develop` required CI gates green;
6. no unresolved release-blocking issue remains.
