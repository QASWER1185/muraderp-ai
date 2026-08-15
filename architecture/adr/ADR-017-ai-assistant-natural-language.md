# ADR-017 — AI Assistant & Natural Language ERP

## Status
Accepted — Phase 13

## Decision
MuradERP-AI will provide a provider-neutral natural-language assistant that translates user questions and controlled action requests into typed intents and authorized ERP service calls. The assistant never receives direct database mutation authority.

## Canonical flow
User text/voice → intent classification → organization/user context → permission check → deterministic ERP/reporting service → result → assistant response.

## Supported initial intents
- reporting.query
- customer.lookup
- vendor.lookup
- product.lookup
- invoice.lookup
- estimate.lookup
- purchase.lookup
- receivable.lookup
- payable.lookup
- inventory.lookup
- estimate.create_draft
- invoice.create_draft
- customer_return.create_draft
- supplier_bill.create_draft
- inventory.adjust_draft

## Safety boundaries
1. Every request is bound to an authenticated organization and user.
2. Read operations use existing authorized reporting/domain services.
3. Mutating requests produce a draft and require explicit confirmation before authoritative ERP mutation.
4. The assistant cannot bypass RBAC, RLS, pricing resolution, accounting validation, or transaction atomicity.
5. Provider-specific LLM behavior remains behind an adapter contract.
6. Ambiguous intent or entity resolution must return a clarification/review state rather than guessing a financial action.

## Phase 13 non-goals
- Autonomous accounting posting
- Direct SQL/database access by the model
- Predictive analytics
- WhatsApp automation
- Provider-specific domain logic
