# ADR-008: Deterministic Price Resolution

## Status
Accepted for Phase 3 implementation.

## Decision
Pricing resolution will be deterministic and server-side.

For a requested product, price type, quantity, and effective timestamp, the pricing domain will consider only active rate-list versions whose effective period contains the requested timestamp. Candidate scope precedence is:

1. CUSTOMER
2. VENDOR
3. GLOBAL

Within the winning scope, the newest effective version wins. Within that version, the highest `minimum_quantity` tier that does not exceed the requested quantity wins.

If no applicable candidate exists, resolution returns `null`; it does not invent or silently fall back to an arbitrary price.

## Rationale
This policy supports supplier-specific purchase rates, customer-specific selling rates, quantity discounts, historical pricing, and future AI/OCR/voice workflows without making AI responsible for financial decisions.

## AI Boundary
AI may extract, match, or suggest pricing context. Final price selection remains deterministic business logic and must pass through the pricing service before a financial document is persisted.
