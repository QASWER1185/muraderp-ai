# ADR-024 — Phase 20 AI Business Copilot & Transaction Orchestration

## Status
Accepted / Architecture Locked

## Decision
MuradERP-AI will implement a controlled AI Business Copilot as an orchestration layer above existing authoritative ERP services. The Copilot may interpret text, voice, images, extract business entities, resolve context, propose an action plan, and request confirmation. It must not directly mutate financial or inventory state, execute arbitrary SQL, or bypass domain services.

## Inputs
- Natural-language text
- Voice transcripts
- Camera/image/document candidates from Phase 18
- Existing ERP document context

## Core pipeline
Input -> intent classification -> entity/context resolution -> structured action plan -> permission/policy validation -> deterministic pricing/domain validation -> confirmation when required -> existing authoritative ERP service -> audit result.

## Transaction scope
The Copilot may orchestrate Estimate, Sales Invoice, Purchase/Supplier Bill, Customer Return, Inventory and supported conversion/read workflows. Existing Phase 17 pricing, Phase 18 document intelligence, and Phase 19 transaction automation are reused; none are reimplemented.

## Pricing authority
Explicit user-provided rates are treated as proposed inputs and validated under existing pricing/business rules. If no explicit rate is supplied, the Phase 17 deterministic Pricing Resolver remains authoritative. The AI model never invents a financial rate.

## Safety boundaries
- Organization and user context are mandatory.
- RBAC/authorization is enforced before execution.
- Ambiguous entities remain unresolved and require user clarification.
- Financial/inventory mutations require appropriate confirmation policy.
- Idempotency and duplicate-action protection are mandatory.
- Every executed AI-assisted action must be auditable.
- AI output is untrusted until validated by deterministic ERP services.

## Non-goals
No direct LLM-to-database writes, arbitrary SQL generation/execution, replacement of domain services, autonomous uncontrolled financial mutations, or separate AI implementations per transaction module.

## Acceptance principle
The Copilot is complete only when voice/image/text can produce validated drafts/actions for supported ERP workflows through the same authoritative services, with deterministic pricing, permissions, confirmation, idempotency, auditability, and complete CI/merge/post-merge verification.
