# MURADERP-AI — PHASE 22 IMPLEMENTATION HANDOFF

## Mission
Complete the AI end-user experience as the last AI feature-development phase before Phase 23 final production closure.

## Source of Truth
- Master Engineering Handoff
- Complete Project Handoff
- Phase 13 AI input foundation
- Phase 17 deterministic pricing
- Phase 18 document intelligence
- Phase 19 transaction automation
- Phase 20 AI Business Copilot
- ADR-026 Phase 22

## Product Goal
MuradERP-AI must be more capable than a QuickBooks-style accounting application by making AI a safe, practical operating interface for building-material, electrical, sanitary, hardware, cement, steel and plumbing businesses.

## Required User Journeys
### Text
User enters: `25mm Popular pipe 50 pcs, 120 rate; 25mm Turk 25 pcs, 10 rate`.
System identifies products, preserves explicit rates, validates context and produces a reviewable draft.

### Selected Rate List
User selects a Rate List first, then enters item + quantity. The selected Rate List is carried into price resolution automatically; user should not re-enter rates unless overriding intentionally and allowed by business rules.

### Voice
Voice capture → transcription adapter → same AI intent/extraction path as text → validation → review → confirmation → authoritative service.

### Camera / Document
Image upload/camera → document extraction boundary → product/vendor/customer/rate matching → review → confirmation → authoritative service.

### Estimate / Invoice
AI must be able to prepare an Estimate or Invoice through the existing ERP services after review/confirmation. No duplicated pricing or accounting logic in the frontend.

### Purchase / Return / Inventory
Use the Phase 20 supported action-plan/execution boundaries. Do not create a parallel transaction engine.

## Implementation Slices
- 22-A: AI Copilot production UI state and conversation model.
- 22-B: text command normalization and action-plan preview.
- 22-C: camera/document upload and extraction-review UX.
- 22-D: voice capture/transcription adapter UX.
- 22-E: product/brand/customer/vendor matching and ambiguity resolution.
- 22-F: Rate List context + deterministic pricing display.
- 22-G: Estimate/Invoice/Purchase/Return/Inventory confirmation flows using existing services.
- 22-H: AI action history/audit/result UX.
- 22-I: responsive/mobile experience and error/permission/loading states.
- 22-J: end-to-end integration/security testing and final CI/merge/post-merge verification.

## Safety Acceptance
- Never expose Supabase service-role or internal secrets.
- Never let AI write arbitrary SQL.
- Never invent a financial rate.
- Never silently select an unresolved brand/product.
- Never bypass organization/branch/RBAC controls.
- Never bypass confirmation for protected mutations.
- Preserve idempotency and auditability.

## Completion Gate
No Phase 22 completion claim until:
1. All supported AI journeys work end-to-end.
2. Existing authoritative ERP services are actually exercised.
3. Tests, typecheck and build pass.
4. Branch CI is green.
5. PR merges to develop.
6. Exact merge commit is verified.
7. Post-merge develop CI is green.

## Phase 23 Boundary
Phase 23 is the final production closure phase: security review, performance, reliability, backup/restore, observability, deployment readiness, release checklist and final regression. No planned new feature phase follows Phase 23.
