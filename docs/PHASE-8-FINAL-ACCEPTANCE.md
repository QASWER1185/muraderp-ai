# Phase 8 — Accounting Ledger & Financial Reporting Foundation

## Final reconciliation

Phase 8 is the accounting ledger foundation defined by the repository roadmap. Its scope is:

- Chart of Accounts foundation
- Double-entry journal entries and journal lines
- Atomic journal posting boundary
- Source identity and idempotency protection
- Balanced and non-zero journal enforcement
- Read-only General Ledger projection
- Read-only Trial Balance projection
- Typed accounting contracts and validation
- ADR-012 architecture decision
- Database smoke/runtime verification

## Current implementation evidence

The accounting domain is present in the canonical `develop` codebase under `backend/src/accounting` and is covered by accounting validation tests and database migrations. The Supabase project contains the authoritative `accounts`, `journal_entries`, `journal_lines`, `general_ledger`, and `trial_balance` relations.

## Final regression hardening

This closure adds `backend/test/phase8-accounting-final-regression.test.ts`, covering:

- multi-line balanced journals
- rejection of negative amounts
- rejection of non-finite amounts
- rejection of zero-value journal lines
- required posting metadata
- balanced posting input at the validation boundary

## Guardrails

- Financial reporting remains read-only.
- AI remains outside the financial mutation boundary.
- Existing purchase, sales, payment, and return transaction boundaries remain authoritative.
- Journal posting remains an accounting boundary and must be balanced, non-zero, and auditable.

## Acceptance rule

Phase 8 is not considered final from code alone. Final closure requires the project's locked acceptance chain: implementation, typecheck, complete tests, build, security/production gates, PR merge, exact merge SHA verification, and successful post-merge `develop` CI. Supabase schema/runtime evidence must also remain verified.
