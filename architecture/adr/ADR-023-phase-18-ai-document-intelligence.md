# ADR-023 — Phase 18 AI-Assisted Document Intelligence

## Status
Accepted — Architecture Locked

## Context
MuradERP-AI is an AI-native ERP for building-material, electric, sanitary, hardware, cement, steel and plumbing businesses. Phase 17-A established deterministic pricing resolution and Phase 17-B integrated that resolver into Estimate pricing. Phase 18 must add the reusable AI input boundary without rebuilding pricing or allowing AI to directly mutate financial data.

## Decision
Create a centralized AI Document Intelligence boundary that converts image, voice and text inputs into validated, structured ERP-entry candidates. The candidate is then resolved through existing authoritative ERP services. AI is never the financial authority.

## Canonical flow
Input (image / voice / text)
→ extraction
→ normalization
→ product/entity matching
→ confidence + ambiguity assessment
→ structured candidate
→ existing deterministic ERP service (including Phase 17 Pricing Resolver)
→ user review when required
→ authoritative document mutation

## Supported first-class inputs
- Camera/image documents and handwritten material lists
- Voice descriptions
- Typed/free-text material lists

## Structured candidate contract
Each candidate line may contain:
- source type
- raw/source reference metadata
- item text
- normalized product identity when matched
- brand
- size/specification
- quantity
- unit
- rate-list hint
- confidence
- ambiguity/unresolved reasons

No candidate may silently become an accounting posting.

## Safety and authority rules
1. AI extraction output is untrusted input.
2. Existing product/customer/vendor/rate-list masters remain authoritative.
3. Existing Phase 17 deterministic Pricing Resolver remains the only pricing authority.
4. Missing or ambiguous products/rates are explicit unresolved states; never fabricate values.
5. User confirmation is required where confidence or ambiguity policy requires it.
6. Manual correction/override remains supported and auditable.
7. Tenant/organization isolation applies at every lookup and mutation boundary.
8. Raw media is not persisted by default; persistence requires an explicit storage policy and reference.
9. Idempotency and duplicate protection are required before document mutation.

## Scope of Phase 18
- Shared extraction/candidate domain contracts
- Image/OCR adapter boundary
- Voice/transcription adapter boundary
- Typed text parser boundary
- Product/entity matching boundary
- Confidence and ambiguity policy
- Candidate review/confirmation boundary
- Integration with Estimate first, while keeping contracts reusable for Invoice, Purchase, Return and Inventory workflows
- Tests for deterministic safety, tenant isolation, malformed input, ambiguity and idempotency

## Explicit non-scope
- Rebuilding the Phase 17 pricing engine
- Direct AI-to-ledger posting
- Rebuilding Estimate pricing
- Full production OCR vendor lock-in
- Full production speech vendor lock-in
- Autonomous financial posting without confirmation policy

## Acceptance criteria
- Same structured candidate contract works for image, voice and typed input.
- Estimate can consume a confirmed candidate without manual re-entry of every field.
- Existing selected Rate List context reaches Phase 17 pricing resolution.
- AI cannot override deterministic pricing authority.
- Ambiguous product/rate cases remain unresolved and visible.
- Tenant boundaries are enforced.
- Duplicate submission cannot create duplicate authoritative entries.
- Adapter/provider interfaces are replaceable without changing ERP domain logic.
- Full automated test, typecheck and build gates pass before merge.
