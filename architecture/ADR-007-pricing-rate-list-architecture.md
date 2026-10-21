# ADR-007 — Pricing and Rate List Architecture

## Status
Accepted — foundation implementation in `feature/pricing-rate-list-foundation`.

## Context
MuradERP-AI must support supplier rate lists, generic pricing, customer-specific selling prices, versioned rates, estimate/quotation/invoice workflows, scanned rate-list ingestion, and future AI price resolution. Product master prices must not be the only source of commercial pricing.

## Decision
Use a normalized pricing model with three layers:

1. `rate_lists` — identifies the commercial price context and its scope.
2. `rate_list_versions` — provides versioning and effective-date control.
3. `rate_list_items` — stores product-level prices and optional quantity tiers.

Rate-list scope is currently one of:

- `GLOBAL` — generic company-wide pricing context.
- `VENDOR` — supplier/source-specific pricing context.
- `CUSTOMER` — customer-specific selling pricing context.

Each rate list has a `price_type` of `PURCHASE` or `SALE`.

Only one version of a rate list may be `ACTIVE` at a time. Historical and future versions remain represented by effective dates and explicit status rather than overwriting prior rates.

## Price-resolution direction
The future resolver will select a product price using:

- transaction purpose (`PURCHASE` or `SALE`),
- target product,
- transaction quantity,
- transaction date/time,
- supplier/customer context,
- applicable rate-list scope,
- active/effective version,
- highest applicable quantity tier.

The exact precedence algorithm will be implemented as a separate, tested business service after the database contract is verified.

## AI compatibility
OCR, camera extraction, supplier rate-list scanning, voice entry, and AI-assisted document conversion will produce structured pricing candidates only. Final price resolution and financial mutations remain under validated application services and database transactions.

## Consequences
- Product master `purchase_price` and `sale_price` remain useful defaults but are no longer the long-term pricing authority.
- Rate history is preserved rather than overwritten.
- Supplier/customer-specific pricing can be introduced without redesigning sales and estimates later.
- One-click bill/estimate adaptation can resolve target-context prices through the same pricing model.
- The schema is intentionally prepared for AI extraction and matching without granting AI direct database authority.

## Next implementation step
After this migration is reviewed and applied safely, add typed backend repository/service contracts for rate-list CRUD and a pure price-resolution algorithm with deterministic tests. Do not connect AI/OCR/voice mutation paths until the pricing service contract is stable.
