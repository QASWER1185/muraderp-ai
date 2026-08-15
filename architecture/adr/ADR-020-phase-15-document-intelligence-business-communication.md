# ADR-020 — Phase 15: Document Intelligence & Business Communication

## Status
Accepted — Phase 15

## Decision
Phase 15 extends the existing Phase 12 AI Input Foundation, Phase 13 AI Assistant, and Phase 14 Inventory Intelligence. It does not duplicate those capabilities.

Documents are treated as untrusted input. The system classifies and extracts structured data, resolves entities against authoritative ERP records, reconciles where possible, and creates a reviewable draft. Financial, inventory, and accounting mutations remain behind existing authoritative ERP services and require explicit confirmation.

## Supported document classes
- supplier bill / supplier invoice
- customer invoice / customer document
- estimate / quotation
- customer return document
- purchase return document
- supplier rate list
- delivery / receiving document
- inventory / stock-count document

## Canonical flow
Document upload/camera/voice/text → classification → extraction → normalization → entity/rate matching → reconciliation → validation/confidence → draft → human confirmation → authoritative ERP service → audit provenance.

## Business communication boundary
Communication is represented as a controlled message intent linked to an organization and optional ERP entity/context. Sending is separate from financial mutation. Provider adapters remain isolated from ERP domain logic. Outbound/inbound messages must be auditable and must not bypass authorization.

## Safety rules
1. Organization and authenticated user context are mandatory.
2. Provider/LLM/OCR adapters never receive direct database mutation authority.
3. Low-confidence or ambiguous extraction produces a review/clarification state.
4. No document may silently overwrite an authoritative ERP record.
5. Duplicate document detection must be supported before posting.
6. Financial/inventory posting uses existing deterministic services and explicit confirmation.
7. Raw documents and extracted fields must retain provenance sufficient for audit and correction.

## Non-goals
- autonomous financial posting
- direct model-to-database writes
- replacing Phase 12 OCR/voice abstractions
- replacing Phase 13 assistant intent handling
- replacing Phase 14 inventory intelligence
- full WhatsApp provider implementation before the communication contract is verified
