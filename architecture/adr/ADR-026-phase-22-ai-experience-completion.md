# ADR-026 — Phase 22 AI Experience Completion

## Status
Accepted / Architecture Locked

## Decision
Phase 22 will convert the verified Phase 13–20 AI foundations into a coherent, real end-user AI experience without rebuilding any completed AI or ERP domain architecture.

Phase 22 is the final AI-experience implementation phase before Phase 23 production closure. Scope is intentionally bounded: no new ERP domain, no autonomous financial mutation, no uncontrolled LLM-to-database path, and no new long-term feature program.

## Objective
Deliver a production-grade AI interaction surface for MuradERP-AI where a user can use text, voice and camera/document input to prepare supported ERP actions, review AI extraction/matching, resolve ambiguity, select or inherit the correct Rate List, and confirm execution through the existing authoritative ERP services.

## Core Experience
Text / Voice / Camera / Document
→ Input normalization
→ AI extraction / intent
→ Product & customer/vendor matching
→ Phase 17 deterministic pricing
→ Validation + confidence
→ Review / correction
→ Human confirmation
→ Phase 20 Copilot action plan
→ Existing authoritative ERP service
→ Inventory / accounting / audit
→ Clear result

## Phase 22 capabilities
1. AI Copilot production UI and conversation state.
2. Text business-command entry.
3. Voice capture/transcription adapter boundary; provider-specific implementation remains behind an interface.
4. Camera/image/document upload boundary for invoices, estimates, purchase bills and rate lists.
5. Structured extraction review UI.
6. Product/brand/rate matching review and ambiguity resolution.
7. Selected Rate List context carried into AI-created estimate/invoice/purchase/return drafts.
8. Explicit user-provided rate precedence and Phase 17 deterministic resolver reuse.
9. Draft → review → confirmation experience.
10. AI-created Estimate and Invoice entry into existing services; supported Purchase/Supplier Bill, Return and Inventory actions where Phase 20 already provides authoritative execution.
11. AI explanation of what will happen before confirmation.
12. Error, confidence, permission and unresolved-entity states.
13. AI action/audit visibility after execution.
14. Responsive desktop/mobile AI workflow.
15. End-to-end tests for supported AI paths and safety boundaries.

## Architectural Rules
- Phase 13 AI interface/foundation is reused; it is not rebuilt.
- Phase 17 deterministic pricing remains authoritative.
- Phase 18 document intelligence remains the extraction boundary.
- Phase 19 transaction automation remains the transaction boundary.
- Phase 20 Copilot remains the orchestration/confirmation boundary.
- AI is untrusted input until deterministic validation succeeds.
- AI never directly writes financial/inventory database records.
- Explicit user rates are never silently replaced by an AI-generated rate.
- When a Rate List is selected, the same context is carried into price resolution.
- Ambiguous product/brand/customer/vendor matches require user resolution.
- Financial/inventory mutations require existing permission, confirmation, idempotency and audit controls.
- No server secrets or Supabase service credentials are exposed to the browser.
- Manual ERP entry remains available; AI is an accelerator, not a prerequisite.

## Non-goals
- Rebuilding Phase 17–20.
- Autonomous uncontrolled transactions.
- Training or building a proprietary foundation model.
- Offline sync.
- Advanced predictive BI.
- New banking/e-invoicing/WhatsApp programs.
- Adding new ERP domains after Phase 22.

## Definition of Done
Phase 22 is complete only when the supported text/voice/image AI workflows are usable through the production UI, safely connect to existing Phase 13–20 boundaries, preserve pricing and authorization rules, provide review/confirmation, execute through authoritative services where supported, handle errors/ambiguity safely, pass automated integration/security tests, pass typecheck/build/CI, merge to develop, and pass exact post-merge develop CI.

Phase 23 will then be the final production closure/hardening/release gate. After Phase 23, no planned feature-development phase remains unless a production defect or security issue requires remediation.
