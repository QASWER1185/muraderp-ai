# MuradERP-AI Product Scope

Last reconciled: 2026-09-09 (Asia/Karachi)

## Purpose

This document preserves agreed product scope independently of implementation status. It must not be used to infer that a capability is implemented, verified, deployed, or production ready. Current evidence belongs in [`MURADERP-AI-MASTER-STATE.md`](MURADERP-AI-MASTER-STATE.md) and [`PRODUCTION-CLOSURE-STATUS.md`](PRODUCTION-CLOSURE-STATUS.md).

MuradERP-AI is an original, AI-native, production-grade ERP for building-material, electrical, sanitary, hardware, cement, steel, plumbing, bricks, and related trading businesses. Familiar accounting products such as QuickBooks are workflow references, not a cloning target or a limit on MuradERP-AI's product direction.

## Scope classification

- **MUST HAVE**: accepted core product or safety capability. A release claiming the relevant product area must satisfy it.
- **AGREED FUTURE/PLANNED**: explicitly accepted or deferred work, but not evidence of current delivery.
- **OPTIONAL/NOT YET AGREED**: ideas, provider choices, or expansions that require a new owner/architecture decision.

## MUST HAVE

### Product and organization foundations

- A modular-monolith ERP with typed application services, repositories, PostgreSQL transaction boundaries, and a responsive web application.
- Multi-organization identity, memberships, role-based permissions, explicit branch context, and server-side authorization.
- Organization/branch isolation at every applicable read and mutation boundary, backed by database ownership constraints and least-privilege policies.
- Server-only secrets; no Supabase service credential, internal API token, provider key, or arbitrary SQL facility in browser code.
- Clear loading, empty, error, permission-denied, retry, and confirmation states.
- Manual entry as a complete first-class workflow; AI must remain optional.

### Master data

- Customers and customer identity/history.
- Vendors/suppliers and supplier identity/history.
- Canonical products, categories, brands/companies, units, and commercial descriptions.
- Warehouses and branch-aware stock context.
- Search, selection, ambiguity handling, and controlled create/update behavior for master data.
- Products remain canonical across brands/rate lists unless they are genuinely different physical products.

### Dynamic pricing and rate lists

- Organization-owned rate lists for SALE and PURCHASE pricing.
- GLOBAL, CUSTOMER, and VENDOR/supplier/company scope where applicable.
- Versioned effective dates and quantity tiers without overwriting history.
- Deterministic server-side price resolution with explicit context precedence.
- Explicit line rate list takes precedence over estimate/document default context.
- Brand/company hints must map to approved organization-owned rate-list context or remain unresolved.
- Ambiguity, missing rates, unresolved brands, incompatible units/currency, inactive lists, and cross-tenant references fail closed.
- Manual rates/overrides remain possible only as explicit, validated, auditable business input.
- Imported/scanned rate-list candidates require review before becoming authoritative pricing.

### Sales documents

- Estimate/Quotation as one non-posting commercial document with configurable user-facing label.
- Approved line order and totals: item, quantity, unit/rate, line amount, discounts, grand total, pass-through rent, and customer payable.
- Expected cost/profit/margin may appear on an estimate but is not authoritative accounting profit.
- Mixed-brand/mixed-rate-list estimates in one document using canonical Product IDs and line-level pricing context.
- Deterministic Estimate clone/reprice with source preservation, full preview, explicit policy, missing-line reporting, confirmation, atomic persistence, provenance, and idempotency.
- Invoice creation directly or from an Estimate through one authoritative atomic sales transaction.
- Estimate -> Invoice creates a new posting document and preserves the non-posting source.
- Invoice posting coordinates inventory, stock movements, receivable, revenue, COGS, pass-through rent, journal, and audit/idempotency as one transaction.
- Customer returns/credit notes use explicit source lines and reverse inventory/receivable/accounting effects atomically.

### Purchasing, inventory, and supplier lifecycle

- Purchases/supplier bills with vendor, warehouse, products, quantities, costs, discounts/tax where supported, references, and dates.
- Purchase posting atomically updates purchase records, inventory, supplier payable, authoritative accounting, and idempotency evidence.
- Vendor payments allocate only to the selected vendor's valid outstanding purchases and cannot over-allocate.
- Warehouse balances and immutable stock-movement history.
- Stock-affecting actions occur only through explicit authoritative transaction services; read APIs do not mutate stock.
- Inventory adjustment/count workflows require reason, actor, organization, branch, cost/accounting-safe validation, and explicit confirmation.
- Reconciliation exposes discrepancies instead of silently changing stock.

### Receivables, payables, accounting, and reporting

- Customer payments with controlled allocations, outstanding-balance validation, atomic receivable/journal effects, and idempotency.
- Vendor payable ledger and vendor-payment allocation lifecycle.
- One authoritative Chart of Accounts and balanced, immutable posted journal.
- Source-linked, organization/branch-aware, idempotent double-entry postings.
- General Ledger and Trial Balance derived from the authoritative journal.
- Reporting projections for sales, purchases, returns, payments, inventory, receivables, payables, cash position, profit/loss foundation, and dashboard drill-down.
- Privacy-first dashboard: the landing page does not expose monetary values; figures require explicit authorized drill-down.
- Pass-through rent remains customer-payable but is not product sales revenue.
- Corrections use explicit reversals/business transactions rather than destructive historical edits.

### AI-native workflows

- One provider-neutral input contract for typed/free text, image/camera/OCR, and voice/transcription.
- Structured candidate fields for party, product, brand/specification, quantity, unit, rate/rate-list context, dates, references, tax/discount, confidence, and unresolved reasons where applicable.
- Organization-scoped deterministic matching against authoritative customers, vendors, products, brands, rate lists, documents, and warehouses.
- Full visibility of ambiguity, confidence, proposed actions, and pricing before confirmation.
- Copilot orchestration for supported Estimate, Invoice, Purchase/Supplier Bill, Return, Inventory, conversion, and read/query workflows.
- Protected actions require human confirmation and call the same authoritative services as manual entry.
- Original input/source metadata, extraction result, corrections, confirmation, and execution result retain audit provenance where storage policy permits.
- No AI/LLM/OCR/voice provider may invent an authoritative rate, bypass RBAC/RLS, write arbitrary SQL, or mutate financial/inventory state directly.

### Documents, communication, offline, and usability

- Print/share-ready Estimate/Quotation and Invoice presentation, with consistent totals and business identity.
- Controlled WhatsApp/message intent linked to the organization and document; sending is separate from posting.
- Replaceable communication providers with server-side credentials and auditable delivery results.
- Responsive desktop/mobile usability for core manual and AI workflows.
- Offline-capable application shell and durable local outbox for supported drafts.
- Offline replay preserves the original idempotency key and never treats local state as authoritative accounting/inventory truth.

### Operational and release safety

- Stable validation/domain errors, request IDs, structured logging with credential redaction, liveness/readiness, and secret-safe diagnostics.
- Production configuration validation that fails closed for missing, placeholder, or unsafe credentials.
- Automated focused tests, regression tests, typecheck, production build, security checks, and migration-provenance validation.
- Forward-only, reproducible migration chain with immutable historical evidence.
- Deployment evidence on an exact versioned commit.
- Backup/snapshot policy and a successfully exercised isolated restore with post-restore schema, security, and business-invariant checks.

## AGREED FUTURE/PLANNED

These items were explicitly accepted or deferred, but are not automatically part of the current verified implementation:

- Concrete production OCR/vision, speech-to-text, and LLM provider adapters behind the accepted interfaces.
- Raw image/document storage, retention, access control, and deletion policy before persistent source-media storage is enabled.
- Production WhatsApp transport/provider integration, delivery tracking, retries, and inbound workflow policy.
- Provider-neutral bank account/feed import and reconciliation restored to the active canonical database schema, followed by API/UI integration.
- An explicit inventory costing decision beyond the current persisted product-cost foundation (for example weighted-average/FIFO), before production valuation is claimed complete.
- Purchase-return authoritative execution and accounting semantics where not already exposed through a verified service boundary.
- Customer credits, refunds, deposits, and unapplied receipts; current customer-payment policy intentionally rejects unallocated/excess cash.
- Full authenticated browser end-to-end tests using disposable fixtures for the major user journeys.
- Actual isolated backup/restore exercise and runbook evidence (Phase 23 Stage 9).
- Completion of the full manual ERP UI, reporting drill-down UI, rate-list authoring UI, document review UI, and provider-backed AI experience required by the accepted Phase 21/22 definitions of done.
- Retirement/archive of legacy `accounting_journal_*` tables after a verified cutover and data-retention decision.
- Reconciliation of accepted ADR/status documents whose completion labels no longer match the active migration chain or current UI.

## OPTIONAL/NOT YET AGREED

The following must not be treated as committed scope without a new product-owner decision and, where architectural, a new ADR:

- Replacing the modular monolith with microservices.
- A direct QuickBooks clone, copied branding, copied UI, or copied source.
- Autonomous financial posting, autonomous stock changes, or an arbitrary model-to-SQL interface.
- A proprietary foundation model or lock-in to a particular LLM/OCR/speech/WhatsApp/bank provider.
- Advanced predictive BI, automated demand forecasting, or autonomous purchasing.
- Full batch/serial/expiry tracking; existing architecture provides readiness only and explicitly avoided premature rules.
- Full offline ERP accounting/inventory authority or peer-to-peer conflict resolution.
- New feature phases after Phase 23 without explicit owner authorization.
- Jurisdiction-specific e-invoicing, tax filing, payroll, manufacturing, or e-commerce modules not covered by a separately approved requirement.

## Scope change rule

Future sessions must not move an item between these sections based on implementation convenience. A scope change requires an explicit product-owner instruction, and an architectural change requires a new ADR. Delivery status must be updated separately in the Master State and Production Closure Status.
