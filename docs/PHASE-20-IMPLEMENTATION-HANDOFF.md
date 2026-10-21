# MURADERP-AI — PHASE 20 IMPLEMENTATION HANDOFF

## Mission
Build the AI Business Copilot & Transaction Orchestration layer on top of the Phase 17, 18 and 19 foundations. Do not rebuild those phases.

## Required capabilities
1. Unified text/voice/image command input boundary.
2. Typed AI intent, entity, context, action-plan and execution-result contracts.
3. Customer/vendor/product/brand/rate-list/warehouse context resolution.
4. Estimate creation from text, voice or image candidates.
5. Sales invoice creation from the same Copilot path.
6. Customer return orchestration.
7. Supplier bill/purchase orchestration.
8. Inventory entry/adjustment orchestration where permitted.
9. Existing-document conversion workflows where supported.
10. Read-only business queries without unnecessary confirmation.
11. Draft workflows with review.
12. Financial/inventory mutation confirmation policy.
13. Explicit-rate validation and Phase 17 fallback pricing.
14. Authorization, organization isolation, idempotency and duplicate protection.
15. Audit trail for AI interpretation, validation, confirmation and execution.

## Implementation order
### Step 1 — Contracts
Create strict TypeScript contracts for intent, entities, context, action plans, validation, confirmation and execution results.

### Step 2 — Copilot orchestration service
Implement a deterministic orchestration boundary that accepts an untrusted AI candidate and produces a validated action plan. No direct persistence from model output.

### Step 3 — Context/entity resolution
Reuse existing customer, vendor, product, inventory and pricing services. Ambiguous matches must remain unresolved.

### Step 4 — Pricing bridge
Reuse Phase 17. Explicit user rates are proposals; selected rate-list/brand context is resolved by the deterministic pricing service.

### Step 5 — Transaction bridge
Reuse Phase 19 transaction automation and existing authoritative domain services for estimate, invoice, purchase, return and inventory operations.

### Step 6 — Confirmation and safety
Apply risk-aware confirmation. Reads may execute immediately; drafts require review; financial/inventory mutations require explicit confirmation according to policy.

### Step 7 — Audit/idempotency
Persist or emit auditable execution metadata and deterministic request fingerprints. Retries must not create duplicate financial transactions.

### Step 8 — Tests
Cover happy paths, ambiguity, wrong organization, unauthorized user, missing context, invalid products, explicit-rate validation, rate fallback, confirmation rejection, duplicate requests, retries, concurrent requests, and audit records.

## AI provider boundary
The LLM/OCR/speech provider is an adapter only. Provider responses are untrusted input. Provider-specific SDK details must not leak into ERP domain services.

## Definition of Done
- Architecture ADR committed.
- All contracts typed and validated.
- Copilot orchestration implemented.
- Text, voice and image candidates share one command pipeline.
- Estimate, invoice, purchase, return and inventory workflows use existing authoritative services.
- Phase 17 pricing is reused.
- Phase 18 extraction is reused.
- Phase 19 transaction automation is reused.
- RBAC/org isolation enforced.
- Confirmation and ambiguity policy tested.
- Idempotency and audit tested.
- Typecheck, tests and production build pass.
- PR CI green.
- PR merged to develop.
- Post-merge develop CI green.
- Only then is Phase 20 Final Pass allowed.
