# ADR-024 — Phase 19 AI-Powered Transaction Automation

## Status
Accepted — Implementation in progress

## Context
Phase 17 established deterministic pricing and Phase 18 established reusable AI document-intelligence candidates. Phase 19 connects those boundaries to authoritative ERP transaction workflows without granting AI direct financial mutation authority.

## Decision
Use a transaction-automation orchestration boundary. AI/document drafts are validated as untrusted candidates, matched against organization-scoped ERP masters, passed through existing deterministic pricing where applicable, and converted into transaction commands. Authoritative transaction services remain responsible for persistence and financial/stock mutations.

## Supported transaction types
- Estimate
- Customer invoice
- Supplier bill / purchase
- Customer return
- Purchase return
- Inventory count

## Canonical flow
Input → Phase 18 candidate → validation → organization/user boundary checks → deterministic pricing → review/confirmation → idempotent transaction command → existing authoritative ERP service → persistence.

## Safety rules
1. AI never writes directly to ledger, inventory, receivables, payables, or transaction tables.
2. A transaction command must carry organization and user context.
3. Document type must match the requested transaction type.
4. Unconfirmed drafts remain `REQUIRES_REVIEW`.
5. Missing/ambiguous data must not be fabricated.
6. Idempotency keys are scoped to the organization and fingerprinted against the request payload.
7. Reusing an idempotency key for a different payload is a conflict.
8. Existing Phase 17 pricing remains the only pricing authority.
9. Manual correction/override remains supported through existing ERP workflows.

## Phase 19 implementation slices
- 19-A transaction contracts and orchestration boundary
- 19-B estimate transaction execution
- 19-C customer invoice execution
- 19-D supplier bill / purchase execution
- 19-E customer/purchase return execution
- 19-F inventory count execution
- 19-G end-to-end API/repository integration and idempotency persistence

## Definition of Done
Every slice must pass typecheck, focused tests, full test suite and build. Final closure additionally requires green branch CI, PR merge to `develop`, and a successful post-merge `develop` CI run on the exact merge commit.
