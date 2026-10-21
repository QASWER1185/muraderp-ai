# Phase 13 — AI Assistant & Natural Language ERP

## Implemented foundation
- Provider-neutral assistant request/response contracts.
- Typed intent vocabulary for ERP reads and draft mutations.
- Deterministic intent resolver as a safe baseline before external LLM providers.
- Authorization mapping for every supported intent.
- Read requests routed only through an injected ERP action gateway.
- Mutating requests routed only to draft creation and marked `requiresConfirmation`.
- Ambiguous requests return clarification rather than guessing.
- Organization and user context are mandatory on every request.

## Future adapters
Provider-specific LLM, speech, and richer entity-resolution adapters can implement the same contracts without changing ERP authorization or transaction rules.

## Acceptance boundary
This phase must not post accounting, inventory, sales, purchase, return, or payment mutations directly from the assistant. All final mutations remain in existing authoritative ERP services after explicit confirmation.
