# Pre-canonical migration history

This directory is NON-EXECUTABLE historical evidence for STEP 6 P0-1R reconciliation.

Normal Supabase migration tooling must use only `supabase/migrations/`. Files under `supabase/migration-history/precanonical/sql/` are preserved historical bytes and MUST NOT be replayed, renamed into the executable directory, or treated as pending migrations.

The authoritative reconciliation strategy is EXACT-LIVE-LEDGER CANONICALIZATION:

1. `supabase/migrations/` contains the exact 27 live migration identities and SQL bytes.
2. The approved pending Phase 7A migration follows those 27.
3. The approved P0-4 Branch Foundation follows Phase 7A.
4. Historical Phase 21 SQL remains `HISTORICAL_ONLY_DO_NOT_APPLY`.

`manifest.json` binds each archived original filename to its original SQL SHA-256, Git blob SHA, classification, and archival reason. The immutable source evidence remains `supabase/migration-provenance/live-applied.json` and `supabase/migration-provenance/phase21-disposition.json`.
