# Phase 8 — Accounting Ledger & Financial Reporting Foundation

Implementation branch: `feature/accounting-ledger-financial-reporting`

PR: #13

Current scope:
- Chart of Accounts foundation
- Double-entry journal entries and lines
- Atomic journal posting boundary
- Idempotency/source identity
- General Ledger projection
- Trial Balance projection
- Typed accounting contracts and validation
- Architecture decision ADR-012
- Database smoke fixture

Merge gate:
- Backend typecheck: required
- Automated tests: required
- Production build: required
- Supabase migration/runtime smoke test: required
- No merge until all gates are green
