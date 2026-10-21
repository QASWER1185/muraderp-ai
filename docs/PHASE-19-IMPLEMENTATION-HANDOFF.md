# MURADERP-AI — PHASE 19 IMPLEMENTATION HANDOFF

## Mission
Implement AI-powered transaction automation on top of the completed Phase 17 deterministic pricing and Phase 18 document-intelligence foundations. Do not rebuild either foundation.

## Authoritative architecture
`Input → AI candidate → normalization/matching → validation → Phase 17 pricing → review/confirmation → idempotent transaction command → authoritative ERP service → persistence`

## First implementation slice
Build the transaction-automation contracts, safety validation, organization/user boundaries, document-to-transaction compatibility checks, deterministic request fingerprinting, and idempotency command boundary. This slice must not mutate financial or inventory records directly.

## Next slices
1. Estimate command execution using existing estimate services.
2. Customer invoice execution using authoritative ERP services.
3. Supplier bill/purchase execution using existing purchase service and idempotency contract.
4. Customer and purchase return execution with inventory/ledger authority retained by ERP services.
5. Inventory-count execution with explicit review and stock mutation authority retained by ERP services.
6. API/repository integration and persistent idempotency.

## Non-negotiable rules
- AI is an untrusted candidate generator.
- Existing masters are authoritative.
- Existing Phase 17 pricing resolver is the only pricing authority.
- No guessed product, rate, customer, vendor, or quantity.
- Organization boundaries apply to every lookup and mutation.
- Every authoritative mutation requires explicit confirmation policy.
- Every externally retried mutation requires idempotency protection.
- Manual entry and manual overrides remain supported.
- Provider adapters must remain replaceable.

## Testing gates
- Unit tests for every state transition.
- Mismatched document/transaction rejection.
- Organization/user boundary rejection.
- Review-required behavior.
- Idempotency replay returns the original command.
- Idempotency key reuse with a different payload is rejected.
- No direct AI mutation path.
- Full typecheck, test and build.
- CI → PR → merge → post-merge develop CI.

## Completion gate
Phase 19 is not final until the exact merge commit on `develop` has a successful post-merge CI run. A green feature branch alone is not sufficient.
