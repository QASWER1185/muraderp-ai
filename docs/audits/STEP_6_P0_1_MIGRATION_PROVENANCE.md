# STEP 6 P0-1 — Migration Provenance Reconciliation

## Scope

This record reconciles the `develop` migration directory with the live
`MuradERP-AI` Supabase migration ledger. It does not change database schema,
data, remote migration history, or the executable migration directory.

The exact live ledger capture is stored as non-executable evidence in
`supabase/migration-provenance/live-applied.json`. The bundle contains the
version, name, statement array, and SHA-256 fingerprint of every live migration.
It must never be copied into `supabase/migrations` or executed as a migration.

## Verified Baseline

| Item | Verified value |
| --- | --- |
| Repository | `QASWER1185/muraderp-ai` |
| Branch | `develop` |
| Starting HEAD | `d825e2b894195c95165de911e92300ca9e8858a2` |
| Starting tree | `9b779fc2901d66b93d15fd196945239ee7543c7b` |
| Supabase project | `MuradERP-AI` |
| Project ID | `pmsowmiivjkwtovynhje` |
| Region | `ap-northeast-2` |
| Project status | `ACTIVE_HEALTHY` |
| PostgreSQL | `17.6.1.155` |
| Latest live version | `20260820055125` |
| Latest repository version | `20260824170000` |
| Live ledger fingerprint | `md5:60945c199a6958998eb75270cef8c712` |
| Backup/PITR visibility | `NOT ACCESSIBLE` through the available project interface |

No database mutation was performed, so backup/PITR capability was not relied on
for this unit.

## Reconciliation Result

| Measure | Result |
| --- | ---: |
| Live applied migrations | 27 |
| Repository migration files | 39 |
| Repository unique versions | 35 |
| Versions present in both ledgers | 3 |
| Exact same-version and same-SQL entries | 2 |
| Live-only versions | 24 |
| Repository-only unique versions | 32 |
| Live entries with a related but different repository file | 20 |
| Live entries without the same repository name/version | 5 |

Supabase migration comparison is version-based. Therefore the current
repository cannot be treated as a safe pending migration set: a direct
`supabase db push` would see substantial two-way history divergence.

The shared `20260815163914` version is not an exact SQL match. The evidence
bundle preserves both its live fingerprint and the immutable repository
baseline fingerprint.

## Required Live-Only Security Provenance

| Live version | Name | Evidence SHA-256 | Active-chain treatment |
| --- | --- | --- | --- |
| `20260815063120` | `phase_10_authorization_service_user_check` | `6d40f2eaa898750edd32be5824d770fbbc29b0eb6dfa2e53512f4d08ab0f3de8` | Archive only; do not reapply |
| `20260815063228` | `phase_10_revoke_public_accounting_rpc_execute` | `8c3ae015b948eb899ffbfce4897e75f62433ece2f97aa077a2d8b1fbf4f6b9ca` | Archive only; do not reapply |
| `20260816092145` | `phase_23_rls_initplan_hardening` | `f0e693907420d3c09fe8b25110a233cb0cac85106b38a705c95afeb94323d11e` | Archive only; do not reapply |

Placing these files at their live timestamps in the executable directory would
not be safe. Their prerequisites use different timestamps in the repository,
so a clean chronological replay could execute the security follow-ups before
their prerequisite objects exist.

## Historical Duplicate Versions

These files are preserved and fingerprinted. They were not renamed, deleted,
or silently consolidated.

| Version | Files | Disposition |
| --- | --- | --- |
| `20260813153000` | `estimate_layouts`, `quotations_foundation` | Historical collision; acknowledged |
| `20260813173000` | `estimate_pricing_selection_modes`, `estimate_rate_list_selection`, `invoice_salesperson_attribution` | Historical collision; acknowledged |
| `20260815090000` | `accounting_ledger_foundation`, `vendor_payables_foundation` | Historical collision; acknowledged |

The provenance validator fails if any additional collision is introduced or if
the acknowledged collision set changes without an explicit evidence update.

## Phase 21 Active-Chain Gate

The following files remain historically preserved:

- `20260815190000_phase21_organization_branch_security.sql`
- `20260815190100_phase21_branch_key_guard.sql`
- `20260815190200_phase21_branch_reference_fix.sql`
- `20260815190300_phase21_schema_validation.sql`

Their status is `PENDING_P0_2_REVIEW` and `executable = false`. P0-1 does not
classify, replace, move, or apply them. The active chain remains blocked until
P0-2 records their approved disposition.

## Canonical Future Migration Sequence

1. Historical live and repository records remain immutable.
2. New executable migrations use a unique 14-digit UTC timestamp.
3. Every new version must be greater than both the current live maximum and the
   repository maximum at creation time. The current exclusive floor is
   `20260824170000`.
4. A new migration must never reuse an already-live or repository version.
5. Live-only evidence stays outside `supabase/migrations`.
6. `supabase migration repair` and direct `db push` remain prohibited until
   a separately approved active-chain reconciliation has been rehearsed.
7. P0-2 must resolve Phase 21 before any tenant-isolation schema migration is
   added or applied.

Supabase references:

- https://supabase.com/docs/reference/cli/supabase-migration-list
- https://supabase.com/docs/reference/cli/supabase-migration-repair

## Validator

Run:

```bash
node scripts/validate-migration-provenance.mjs
```

The validator verifies:

- the complete live evidence bundle fingerprint;
- live statement fingerprints and unique versions;
- immutable repository baseline file fingerprints;
- the acknowledged duplicate-version set;
- archive-only live versions remain outside the executable chain;
- Phase 21 remains gated pending P0-2;
- every future migration uses a new version above the canonical floor.

A successful validator result confirms provenance integrity. It does not mean
the active migration chain is deployable.

## P0-1 Decision

`PROVENANCE RESTORED AS NON-EXECUTABLE EVIDENCE`

`ACTIVE MIGRATION CHAIN: BLOCKED`

Blockers:

- P0-2 Phase 21 disposition is pending.
- Live and repository version sets materially diverge.
- Historical repository duplicate versions require an approved long-term
  baseline strategy.
