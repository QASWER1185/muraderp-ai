# ADR-021 — Phase 16: Bank Feeds & Bank Reconciliation Foundation

## Status
Accepted — Phase 16

## Decision
Phase 16 adds a provider-neutral banking and reconciliation domain on top of the existing accounting ledger, receivables, payables, payment, security, and audit boundaries. It does not create a second accounting ledger.

## Scope
- bank account registry and organization isolation
- provider-neutral bank feed adapter contract
- normalized bank transactions
- duplicate transaction detection
- deterministic matching rules plus AI-assisted match suggestions
- customer receipt matching
- vendor payment matching
- unmatched and partial-match workflows
- reconciliation sessions and audit trail
- controlled posting through existing authoritative accounting services

## Canonical flow
Bank/provider feed → adapter → normalization → deduplication → deterministic matching → optional AI suggestion → review → explicit confirmation → existing accounting/payment service → reconciliation audit.

## Safety boundaries
1. Organization and authenticated user context are mandatory.
2. Bank providers and AI adapters never receive direct ledger mutation authority.
3. AI may suggest matches with confidence and rationale but cannot post entries.
4. Ambiguous, duplicate, or low-confidence transactions require review.
5. Reconciliation never silently overwrites authoritative ledger records.
6. Posting must use existing deterministic accounting services and atomic transaction boundaries.
7. Imported bank data retains source provenance and idempotency keys.

## Non-goals
- direct bank credentials stored in application tables
- provider-specific business logic in the domain layer
- autonomous financial posting
- replacement of the existing accounting ledger
- predictive cash-flow analytics in this phase
