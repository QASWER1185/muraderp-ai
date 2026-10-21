# ADR-019 — Phase 14 Advanced Inventory Intelligence

## Status
Accepted — Phase 14

## Decision
Phase 14 extends the existing deterministic inventory domain into an intelligence layer without rebuilding Phase 13. Phase 13 AI Assistant is the natural-language interface; Phase 14 owns inventory intelligence, reconciliation, availability, valuation foundations, and controlled adjustment drafts.

## Scope
- Multi-warehouse inventory visibility
- Stock movement and availability queries
- Low-stock/reorder intelligence foundation
- Inventory reconciliation and auditability
- Stock valuation foundation
- Inventory adjustment drafts with explicit confirmation
- AI-facing inventory query/action contracts through Phase 13
- Batch/serial/expiry readiness without prematurely implementing unsupported business rules

## Canonical flow
AI Assistant / UI → authorized inventory intent → deterministic inventory service → inventory read model or validated draft → explicit confirmation for mutation → atomic inventory service → audit trail.

## Invariants
1. Inventory remains authoritative in existing ERP transaction services.
2. AI never writes directly to inventory tables.
3. Every operation is organization-scoped and permission-gated.
4. Availability and valuation are derived from authoritative inventory movements, not duplicated mutable counters.
5. Adjustments require reason, actor, organization, and explicit confirmation.
6. Reconciliation must expose discrepancies without silently correcting them.
7. Multi-warehouse operations must preserve warehouse identity and prevent cross-organization leakage.
8. Pricing/rate resolution remains owned by the existing deterministic pricing architecture.

## Non-goals
- Rebuilding Phase 13 assistant
- Autonomous stock posting
- Full batch/serial/expiry implementation unless required by existing domain contracts
- Predictive demand forecasting
- Supplier/WhatsApp workflows

## Acceptance gates
Typecheck, unit/integration tests, build, security audit, authorization/tenant isolation tests, Supabase runtime verification where applicable, PR review, merge, and post-merge develop CI must all pass before Phase 14 is final.