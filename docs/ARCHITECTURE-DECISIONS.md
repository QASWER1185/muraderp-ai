# MuradERP-AI Architecture Decisions

Last reconciled: 2026-09-09 (Asia/Karachi)

Repository baseline: `p0-8-authoritative-accounting-posting-20260829` at `e81ac8aee85937d816cfaade6929b3eeeb046489`, plus the preserved dirty worktree.

## Purpose and authority

This file is the project-level decision index. It does not replace the detailed ADRs. When this index and an ADR disagree with executable code, active migrations, or verified tests, the current repository evidence wins and the conflict must be recorded in `MURADERP-AI-MASTER-STATE.md`.

Decision status and implementation status are separate:

- **Accepted/Agreed** means the product or architecture decision is approved.
- **Implemented** means corresponding code or schema exists.
- **Verified** means named evidence passed for the exact revision or worktree being described.
- **Production ready** additionally requires a clean versioned release, production configuration, deployment evidence, and operational recovery proof.

## Project-level decisions that must not be forgotten

1. **Original product, QuickBooks-informed workflow.** MuradERP-AI may learn from familiar accounting workflows but is not a QuickBooks clone in implementation, branding, or product boundary.
2. **Modular monolith first.** Express/TypeScript application services and repositories sit above Supabase PostgreSQL. Services are split only when demonstrated scale or operational need justifies it.
3. **One authoritative mutation path per business event.** Financial and stock effects must occur through typed application services and atomic database transactions. Browser code and AI providers are never authoritative writers.
4. **AI is untrusted proposal input.** Text, image, camera, OCR, voice, and LLM output may extract, classify, match, explain, and draft. Ambiguous or low-confidence data remains unresolved. Protected mutation requires deterministic validation and explicit confirmation.
5. **Canonical product identity.** A physical product is not duplicated merely because it has several brands, suppliers, companies, or rate lists. Commercial pricing context belongs to rate lists and document lines.
6. **Deterministic pricing.** The canonical chain is Product -> Rate List -> Version -> Item -> deterministic resolution. Explicit line context wins. Missing, ambiguous, unresolved-brand, or incompatible pricing fails closed.
7. **Mixed-brand estimates are first-class.** One estimate may contain lines from different approved rate lists. Clone/reprice creates a new estimate, preserves the source, previews every target rate, and uses an explicit conversion policy.
8. **Estimate and quotation are one non-posting domain.** They are labels for the same commercial document. No estimate/quotation changes stock, receivables, revenue, COGS, or the ledger.
9. **Invoice creation is the sales posting boundary.** Direct invoice and Estimate -> Invoice use the same atomic posting pipeline. There is no required separate user-facing "Post Invoice" action.
10. **One authoritative accounting ledger.** `accounts`, `journal_entries`, and `journal_lines` are authoritative. `accounting_journal_entries` and `accounting_journal_lines` are legacy/non-authoritative and must receive no new production writes.
11. **Pass-through rent is not sales revenue.** It may be customer-payable but is separately classified as a liability/pass-through amount.
12. **Multi-organization and branch isolation are architectural requirements.** Authenticated identity, backend permissions, organization/branch ownership, and database policy/privilege controls provide defense in depth.
13. **Idempotency and audit are mandatory for retried mutations.** Same-key/same-request replay returns the original result; same-key/different-request is a conflict.
14. **Manual entry remains first-class.** AI assistance may accelerate work but cannot be required to operate the ERP.
15. **Offline mode is capture, not a second ledger.** Supported drafts may queue locally; final permission, pricing, accounting, and inventory decisions remain server-authoritative.
16. **Provider neutrality.** OCR, speech, LLM, bank, and communication providers remain adapters. Provider-specific types and credentials do not enter the domain layer or browser bundle.
17. **Forward-only database change.** New schema work uses new migrations. Historical migration evidence is preserved; production is never reset or reconciled by guesswork.
18. **Phase 23 governance.** After the agreed closure program, new feature programs require an explicit product-owner decision. Maintenance, security, compatibility, integrity, and production-defect work remain allowed.

## Authoritative ADR index

| Decision | Status in source | Durable rule | Source |
|---|---|---|---|
| Estimate/Quotation unification | Accepted | One non-posting commercial document; quotation is an alias/label. | [`docs/adr/ADR-003-estimate-quotation-unified.md`](adr/ADR-003-estimate-quotation-unified.md) |
| Pricing and rate-list model | Accepted | Versioned GLOBAL/VENDOR/CUSTOMER rate lists; product master price is not the long-term commercial authority. | [`architecture/ADR-007-pricing-rate-list-architecture.md`](../architecture/ADR-007-pricing-rate-list-architecture.md) |
| Deterministic price resolution | Accepted | Scope, effective version, and quantity tier are resolved server-side; no invented fallback. | [`architecture/ADR-008-deterministic-price-resolution.md`](../architecture/ADR-008-deterministic-price-resolution.md) |
| Inventory read boundary | Accepted by implementation | Stock reads are non-mutating; movements are audit evidence; writes use explicit transactions. | [`architecture/ADR-009-inventory-stock-read-boundary.md`](../architecture/ADR-009-inventory-stock-read-boundary.md) |
| Atomic sales transaction | Accepted by implementation | Invoice creation atomically coordinates stock, receivable, revenue, COGS, rent, journal, and idempotency. | [`architecture/ADR-010-sales-transaction-atomicity.md`](../architecture/ADR-010-sales-transaction-atomicity.md) |
| Customer payment/receivables | Accepted | One atomic `record_customer_payment` boundary; overpayment/unapplied cash is deferred. | [`docs/adr/ADR-011-customer-payments-receivables-transaction.md`](adr/ADR-011-customer-payments-receivables-transaction.md) |
| Accounting ledger/reporting | Accepted | Balanced immutable journal and read-only GL/trial-balance projections; no generic browser journal CRUD. | [`docs/adr/ADR-012-accounting-ledger-financial-reporting.md`](adr/ADR-012-accounting-ledger-financial-reporting.md) |
| Vendor payables/purchase input | Accepted | Purchase remains stock authority; AI input is proposal-only; AP/payment/return effects are atomic and auditable. | [`docs/adr/ADR-013-vendor-payables-purchase-input.md`](adr/ADR-013-vendor-payables-purchase-input.md) |
| Identity/organization/RBAC | Accepted | Supabase Auth identity plus memberships, roles, permissions, backend checks, and database defense in depth. | [`docs/adr/ADR-014-identity-organization-authorization.md`](adr/ADR-014-identity-organization-authorization.md) |
| Reporting/dashboard intelligence | Accepted | Reports are reproducible read projections over authoritative data. | [`docs/adr/ADR-015-reporting-dashboard-financial-intelligence.md`](adr/ADR-015-reporting-dashboard-financial-intelligence.md) |
| Privacy-first dashboard | Accepted | Initial dashboard shows heads/labels, not raw financial values; drill-down is explicit and authorized. | [`docs/adr/ADR-015A-privacy-first-dashboard.md`](adr/ADR-015A-privacy-first-dashboard.md) |
| AI input foundation | Accepted | Text/image/camera/voice share a provider-neutral draft/review/confirmation pipeline. | [`architecture/adr/ADR-016-ai-input-foundation.md`](../architecture/adr/ADR-016-ai-input-foundation.md) |
| Natural-language assistant | Accepted | Typed intents and authorized gateways; ambiguous requests clarify; mutations remain drafts. | [`architecture/adr/ADR-017-ai-assistant-natural-language.md`](../architecture/adr/ADR-017-ai-assistant-natural-language.md) |
| AI provider boundary | Accepted | LLM/OCR/speech providers cannot bypass authorization or repositories/services. | [`architecture/adr/ADR-018-phase-13-provider-boundary.md`](../architecture/adr/ADR-018-phase-13-provider-boundary.md) |
| Inventory intelligence | Accepted | Deterministic queries and confirmation-gated adjustment drafts; no autonomous posting. | [`architecture/adr/ADR-019-phase-14-advanced-inventory-intelligence.md`](../architecture/adr/ADR-019-phase-14-advanced-inventory-intelligence.md) |
| Document intelligence/communication | Accepted | Documents are untrusted candidates; source/provenance and duplicate controls are retained; send is separate from posting. | [`architecture/adr/ADR-020-phase-15-document-intelligence-business-communication.md`](../architecture/adr/ADR-020-phase-15-document-intelligence-business-communication.md) |
| Bank feeds/reconciliation | Accepted | Provider-neutral ingest, deduplication, suggestions, review, and accounting-service posting. | [`architecture/adr/ADR-021-phase-16-bank-feeds-reconciliation.md`](../architecture/adr/ADR-021-phase-16-bank-feeds-reconciliation.md) |
| Estimate pricing integration | Accepted | Estimate lines reuse deterministic pricing; explicit line selection wins; provenance and manual override are retained. | [`architecture/adr/ADR-022-phase-17B-estimate-pricing-integration.md`](../architecture/adr/ADR-022-phase-17B-estimate-pricing-integration.md) |
| AI document intelligence | Accepted/locked | Central candidate contract for image, voice, and text; Estimate-first integration; raw media needs a separate storage decision. | [`architecture/adr/ADR-023-phase-18-ai-document-intelligence.md`](../architecture/adr/ADR-023-phase-18-ai-document-intelligence.md) |
| AI transaction automation | Closed for foundation only | Validated candidates become idempotent commands; downstream execution slices retain their own closure gates. | [`architecture/adr/ADR-024-phase-19-ai-transaction-automation.md`](../architecture/adr/ADR-024-phase-19-ai-transaction-automation.md) |
| AI Business Copilot | Accepted/locked | Copilot orchestrates existing services and confirmation; it is never a parallel transaction engine. | [`architecture/adr/ADR-024-phase-20-ai-business-copilot-transaction-orchestration.md`](../architecture/adr/ADR-024-phase-20-ai-business-copilot-transaction-orchestration.md) |
| ERP product UI | Accepted/locked | Complete manual ERP surface must call existing backend boundaries and preserve role/org/branch context. | [`architecture/adr/ADR-025-phase-21-erp-product-completion.md`](../architecture/adr/ADR-025-phase-21-erp-product-completion.md) |
| AI end-user experience | Accepted/locked | Text/voice/image review and execution UX must reuse Phases 13-20. | [`architecture/adr/ADR-026-phase-22-ai-experience-completion.md`](../architecture/adr/ADR-026-phase-22-ai-experience-completion.md) |
| Final production closure | Accepted/locked | Closure/hardening only; CI is necessary but not sufficient; operational recovery is part of readiness. | [`architecture/adr/ADR-027-phase-23-final-production-closure.md`](../architecture/adr/ADR-027-phase-23-final-production-closure.md) |
| Estimate/Invoice posting model | Accepted project decision | Estimate is non-posting; Invoice is the atomic posting transaction; conversion preserves source identity. | [`docs/decisions/ADR-ESTIMATE-INVOICE-POSTING-MODEL.md`](decisions/ADR-ESTIMATE-INVOICE-POSTING-MODEL.md) |
| Authoritative/legacy ledger cutover | Decision implemented, source still says acceptance candidate | `journal_*` is authoritative; `accounting_journal_*` is legacy and must not receive new writers. | [`docs/architecture/P0_7_DUAL_ACCOUNTING_LEDGER_DECISION.md`](architecture/P0_7_DUAL_ACCOUNTING_LEDGER_DECISION.md) |

## Recorded conflicts and supersessions

- Two files use ADR number **024** (Phase 19 and Phase 20). Their decisions are complementary, but future ADRs must use unique identifiers.
- The P0-7 document still says "acceptance candidate," while active P0-8/non-sales migrations implement its `journal_entries`/`journal_lines` direction. Treat the implementation direction as current and the ADR status label as stale pending a documentation-only correction.
- `README.md` describes authentication, estimates, invoices, AI, organization isolation, and offline sync as unverified. That statement is an older baseline and is superseded by current source/tests for implementation status, but not by itself for production deployment status.
- Phase 12 was once declared the final phase; later accepted ADRs 017-027 and their implementation history supersede that roadmap limit.
- ADR-027 describes Phases 21 and 22 as completed foundations. Current source does not satisfy their full UI/provider definitions of done; the architectural boundaries remain accepted, while completion is recorded conservatively in `PRODUCTION-CLOSURE-STATUS.md`.
- Historical Phase 16 records a bank-feed schema as complete, but the active 36-migration chain does not create the bank tables referenced by `SupabaseBankReconciliationRepository`. The active chain is the current database source of truth.

## Change rule

Do not silently edit an accepted decision while implementing a feature. If a decision must change, add a new uniquely numbered ADR that names the superseded decision, the migration/data impact, and the verification required. Update this index and the Master State in the same change.
