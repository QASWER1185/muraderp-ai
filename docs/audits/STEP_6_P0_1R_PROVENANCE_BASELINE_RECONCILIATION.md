# STEP 6 — P0-1R Provenance Baseline Reconciliation

## Scope

This record reconciles the migration-provenance validator with the legitimate repository state after the approved P0-1 → P0-2 progression. It does not redesign the migration system, change production Supabase, alter migration history, or modify historical migration SQL.

## Previous authoritative evidence

P0-1 commit:

`615494767e0df48727c93f83d6359aacaed202a5`

P0-1 evidence file:

`supabase/migration-provenance/live-applied.json`

The evidence file remains the immutable capture of the live ledger and repository baseline at P0-1. Its Git blob is unchanged across P0-1, P0-2, and the current P0-8 starting HEAD:

`2111460e97e74877a200a66ffb0051e0d32ea7ee`

The approved evidence SHA-256 remains:

`749201cd05b6d11f2bc6a8d17e4277921b5f76f607d20bee639253211de3123a`

No replacement provenance baseline is required by this reconciliation.

## Phase 21 progression

The P0-1 evidence correctly preserves the captured source state:

- disposition: `PENDING_P0_2_REVIEW`
- executable: `false`

P0-2 resolved the disposition additively rather than rewriting P0-1 evidence.

P0-2 commit:

`981d831f8f1e46e5251a1ea5e783365368205a3f`

Disposition file:

`supabase/migration-provenance/phase21-disposition.json`

Disposition:

`HISTORICAL_ONLY_DO_NOT_APPLY`

The disposition Git blob remains unchanged from P0-2 through the current starting HEAD:

`83077e5b41689749576db7a6177ae2ec2bc5ced4`

The four Phase 21 SQL files remain historical and immutable. They must not be applied as the tenant-isolation foundation.

## Historical migration integrity

A targeted Git comparison from P0-1 commit `6154947...` to current starting HEAD `d06834f...` shows no modified historical file under `supabase/migrations`.

Repository evolution after P0-1 added forward migration candidates, including:

- `20260828182231_branch_foundation.sql`
- `20260829062845_p0_5_membership_branch_access_foundation.sql`
- `20260829065058_p0_6_service_principal_security_foundation.sql`

The P0-1 historical migration set was not rewritten in this progression.

Representative exact Git-blob checks also match the P0-1 baseline, including:

- `20260809141445_establish_database_foundation.sql` → `e2eae9e2d78dbd3112d2beacbdabb8d03e7bdb44`
- `20260815190000_phase21_organization_branch_security.sql` → `254857523b9d663b07845f43d478c3327826b3f7`

Therefore the reported historical fingerprint failures are not evidence of unauthorized historical SQL modification.

## Root cause

The provenance validator hashed text as read from the working tree. On Windows, Git may expose repository text using CRLF line endings even when the committed Git blob uses LF. The repository has no `.gitattributes` file forcing checkout EOL behavior, while `.editorconfig` specifies LF for editors.

Consequences on a Windows checkout can include false failures for:

- the immutable evidence bundle SHA-256;
- historical migration SQL SHA-256 values;
- computed Git blob SHA values.

The underlying Git blobs remain unchanged.

## Controlled correction

The validator now canonicalizes only CRLF checkout conversion to LF before computing text SHA-256 and Git-blob fingerprints.

This is not a baseline weakening:

- expected evidence SHA-256 is unchanged;
- expected historical SQL SHA-256 values are unchanged;
- expected historical Git blob SHAs are unchanged;
- expected Phase 21 disposition is unchanged;
- missing files still fail;
- renamed files still fail;
- SQL content changes still fail;
- duplicate-version changes still fail;
- live/repository relation changes still fail.

Only platform-specific CRLF/LF presentation is normalized.

## Required genuine validation

The authoritative result still requires execution from the genuine repository checkout:

`node scripts/validate-migration-provenance.mjs`

Only actual output `MIGRATION_PROVENANCE_VALID` may be accepted as PASS.

If any mismatch remains, stop and report the exact remaining validator failures. Do not weaken the validator and do not modify historical SQL to make it pass.

## Safety status

- Production Supabase mutation: **NONE**
- `supabase db push`: **NOT RUN**
- migration repair: **NOT RUN**
- historical migration SQL modification: **NONE**
- P0-8 migration generation: **NOT STARTED**
- P0-9: **NOT STARTED**
