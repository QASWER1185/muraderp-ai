# ADR-024 — Phase 19 AI-Powered Transaction Automation

## Status
Closed — Final audit remediation complete; closure pending exact post-merge CI verification.

## Context
Phase 17 established deterministic pricing and Phase 18 established reusable AI document-intelligence candidates. Phase 19 establishes the transaction-automation boundary that converts validated AI/document candidates into safe, idempotent transaction commands without granting AI direct financial mutation authority.

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
10. Runtime input is treated as untrusted even when TypeScript types appear correct at compile time.

## Phase 19 implementation slices
- 19-A transaction contracts and orchestration boundary
- 19-B estimate transaction execution
- 19-C customer invoice execution
- 19-D supplier bill / purchase execution
- 19-E customer/purchase return execution
- 19-F inventory count execution
- 19-G end-to-end API/repository integration and idempotency persistence

## Final audit scope
The Phase 19 final audit closes the transaction-automation foundation delivered by the original Phase 19 implementation: contracts, document/transaction compatibility, context boundaries, deterministic fingerprinting, idempotency command handling, review gating, and runtime hardening. Downstream authoritative execution slices remain governed by their own implementation/closure gates and are not falsely marked complete by this audit.

## Final audit remediation
- Added runtime allowlisting for all supported automated transaction types.
- Added strict request context string validation.
- Added idempotency-key type, whitespace, and maximum-length validation.
- Added malformed document-draft shape guards before delegated validation.
- Normalized the stored idempotency key after validation.
- Converted delegated document validation failures into stable API errors.
- Added regression tests for runtime enum spoofing, malformed requests, oversized/blank idempotency keys, malformed drafts, and safety invariants.

## Definition of Done
Focused tests, full backend typecheck/test/build, security gate, PR CI, merge to `develop`, exact merge SHA, and successful post-merge `develop` verification on that exact merge commit are required before Phase 19 is FINAL/PASS/CLOSED.
