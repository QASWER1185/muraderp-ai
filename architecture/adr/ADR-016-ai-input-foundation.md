# ADR-016 — AI Input Foundation

## Status
Accepted — Phase 12

## Decision
MuradERP-AI will provide one provider-neutral AI input pipeline for typed text, images/camera captures, and voice. The pipeline produces a structured, reviewable draft; it never writes directly to ERP tables.

## Supported business intents
- Estimate creation/update
- Invoice creation/update
- Customer return
- Supplier/vendor bill / purchase draft
- Inventory adjustment/count draft

## Canonical flow
Input (text/image/voice) → normalization → extraction → entity/product/rate matching → validation → confidence scoring → human confirmation → authoritative ERP service → audit/provenance.

## Manual entry
Manual entry remains a first-class path. AI assistance is optional and must not make manual workflows impossible.

## Safety boundaries
1. AI output is untrusted proposal data.
2. Financial, inventory, receivable, payable, and accounting mutations must go through existing authorized ERP services.
3. Organization and permission context from Phase 10 applies to every input and draft.
4. Low-confidence or ambiguous fields require explicit user review.
5. Original input metadata/provenance must be retained for auditability where applicable.

## Future provider strategy
OCR/vision, speech-to-text, and LLM providers are adapters behind stable application contracts. Provider choice must not leak into domain services.

## Non-goals for Phase 12
- Full conversational AI assistant
- Autonomous posting without confirmation
- WhatsApp automation
- Predictive analytics
- Provider-specific business logic
