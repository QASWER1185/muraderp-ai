# STEP 6 — P0-1R Provenance Baseline Reconciliation

## Scope

This is the final controlled P0-1R reconciliation pass. It does not redesign the migration system, modify historical migration SQL, repair migration history, apply migrations, or mutate production Supabase.

## Previous authoritative baseline

- P0-1 commit: `615494767e0df48727c93f83d6359aacaed202a5`
- Immutable live evidence bundle SHA-256: `749201cd05b6d11f2bc6a8d17e4277921b5f76f607d20bee639253211de3123a`
- Live evidence file: `supabase/migration-provenance/live-applied.json`
- Live evidence Git blob: `2111460e97e74877a200a66ffb0051e0d32ea7ee`

The P0-1 bundle remains historical evidence and is not rewritten by this reconciliation. No environment-specific replacement baseline is created.

## Approved progression examined

The ancestry from P0-1 to the accepted P0-7/P0-8 starting state is an eight-commit forward progression:

1. `981d831f8f1e46e5251a1ea5e783365368205a3f` — P0-2 Phase 21 disposition.
2. `f4488ff462e98a9c71d7ad328491f04410d7d1da` — P0-4 branch foundation.
3. `f7bc6154423c891d92998f731eae591fcd5299b6` — P0-3 existing-data ownership gate.
4. `b0650fec332e2bae2ea4d412b7bfed8f53b259bc` — P0-5 membership/branch-access foundation.
5. `880fe671ad93818e1ec46b87ac0fca2a7824bc4e` — P0-5 RLS hardening fix.
6. `baee2b5bc43bdbc8fbf2752cc412e83c59a023d2` — P0-6 service-principal foundation.
7. `208220c647d86d7e02dab945b2baf4be4bbd14e6` — P0-6 validator-path fix.
8. `d06834faf81d302b2af01807c43e40d76d4fc285` — P0-7 accounting architecture decision and P0-8 starting state.

P0-3 was intentionally based on the already accepted P0-4 repository state; unit numbering does not imply Git ancestry order.

## Migration-file change reconciliation

Comparison of P0-1 commit `6154947...` to `d06834f...` shows no modification, deletion, rename, or restoration of any migration SQL file that already existed at P0-1.

Only three migration files were introduced after P0-1:

| Migration | Change | Responsible commit(s) | Conclusion |
| --- | --- | --- | --- |
| `20260828182231_branch_foundation.sql` | Added | `f4488ff462e98a9c71d7ad328491f04410d7d1da` | Approved P0-4 forward migration |
| `20260829062845_p0_5_membership_branch_access_foundation.sql` | Added, then hardened before production application | `b0650fec332e2bae2ea4d412b7bfed8f53b259bc`, `880fe671ad93818e1ec46b87ac0fca2a7824bc4e` | Approved P0-5 forward migration evolution |
| `20260829065058_p0_6_service_principal_security_foundation.sql` | Added | `baee2b5bc43bdbc8fbf2752cc412e83c59a023d2` | Approved P0-6 forward migration |

P0-2 did not edit Phase 21 SQL. P0-3 created no migration. P0-7 created no migration. No P0-8 migration exists in the reconciled state.

## Live-applied evidence bundle

`supabase/migration-provenance/live-applied.json` has the same committed Git object from P0-1 through the approved progression. Its expected SHA-256 therefore remains unchanged.

The Windows working-tree fingerprint mismatch is not promoted into a new evidence baseline.

## Phase 21 disposition evolution

P0-1 captured Phase 21 as pending controlled disposition. P0-2 commit `981d831f8f1e46e5251a1ea5e783365368205a3f` added `supabase/migration-provenance/phase21-disposition.json` without modifying the historical Phase 21 SQL.

Authoritative status remains:

`HISTORICAL_ONLY_DO_NOT_APPLY`

The current committed Git blob identities of all four Phase 21 SQL files match the immutable fingerprints recorded by the P0-2 disposition manifest. Phase 21 remains non-executable and replacement-required.

## Root cause of the Windows validator failure

The original validator read provenance JSON and migration SQL from working-tree files and calculated SHA-256 and synthetic Git-blob SHA from those checkout bytes.

A Windows checkout can materialize LF repository text as CRLF while Git still reports the working tree clean. A targeted reproduction confirmed this behavior: the CRLF working-tree raw blob hash differed while `git cat-file blob HEAD:<path>` preserved the committed LF blob identity.

This explains the simultaneous bundle, historical SQL, and synthetic Git-blob mismatches without any corresponding committed historical migration change.

## Reconciliation implementation

An intermediate candidate commit `fcb02a5c8b6a98224e2a31a257447afe0088524a` normalized CRLF before hashing. That correctly addressed checkout presentation, but the final fail-closed implementation does not rely on normalization because normalization could hide a committed line-ending-only change.

The final validator is hardened as follows:

1. `supabase/migrations` and `supabase/migration-provenance` must be clean and committed before validation.
2. Provenance JSON and migration SQL fingerprints are calculated from canonical committed Git object bytes using `git cat-file blob HEAD:<path>`.
3. The P0-1 evidence SHA-256 expectation remains unchanged.
4. Every historical SQL SHA-256 expectation remains unchanged.
5. Every historical Git blob expectation remains unchanged.
6. Phase 21 P0-2 disposition checks remain enforced.
7. Future-version, duplicate-version, live/repository-relation, archive-only, and deployability checks remain enforced.
8. Untracked or modified provenance inputs fail before validation.

This changes the validator's evidence source from platform-dependent checkout bytes to canonical committed Git objects. It does not weaken or replace the baseline.

## Historical migration integrity conclusion

**NO UNEXPLAINED HISTORICAL MIGRATION MODIFICATION FOUND.**

All committed migration changes after P0-1 are attributable to approved forward project commits. Pre-P0-1 migration Git objects remain unchanged through the approved progression.

## Required genuine validation

The final authority remains actual execution on a genuine repository checkout:

`node scripts/validate-migration-provenance.mjs`

Only literal output `MIGRATION_PROVENANCE_VALID` is accepted as PASS. Any remaining mismatch requires an immediate stop and exact failure report.

## Safety status

- Production Supabase mutation: **ZERO**
- `supabase db push`: **NOT RUN**
- migration repair: **NOT RUN**
- database reset: **NOT RUN**
- historical migration SQL modification: **NONE**
- migration rename/delete/restore: **NONE**
- P0-8 migration generation: **NOT STARTED**
- P0-9: **NOT STARTED**
