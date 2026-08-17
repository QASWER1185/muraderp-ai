# Phase 12 — AI Input Foundation

This module implements the provider-neutral AI input boundary defined by ADR-016.

## Canonical flow

Input (text/image/camera/voice) -> provider extraction -> structured draft -> validation -> confidence checks -> human confirmation -> authoritative ERP service.

AI output is untrusted proposal data. This module never writes directly to ERP tables and contains no Supabase/database mutation authority.

## Security invariants

- Every request carries organization and user context.
- Drafts are organization-scoped.
- Extracted confidence must be within 0..1.
- Confirmation is impossible before validation.
- Confirmation remains an explicit human action.
- Provider implementations remain behind `AiInputProvider`.
- The canonical Phase 12 contract is `ai-input.types.ts`; `contracts.ts` re-exports that contract surface and adds only pipeline-specific validation types.

## Phase 12 supported intents

- `estimate.create`
- `invoice.create`
- `customer_return.create`
- `supplier_bill.create`
- `inventory.adjust`

Phase 13's conversational assistant is intentionally outside this module.
