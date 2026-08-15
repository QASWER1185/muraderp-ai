# ADR-011 — Deterministic Pricing Resolution for AI-Assisted Documents

## Status
Proposed — Phase 17.

## Decision
MuradERP-AI will resolve estimate, quotation, invoice, purchase, and future document line prices through one deterministic Pricing Service.

A user may select a Rate List before AI-assisted entry. AI may extract item name, brand, size/specification, quantity, and unit from text, voice, or image input. AI output is a structured candidate only. The Pricing Service resolves the applicable rate from the selected pricing context or explicit item-level brand/rate context.

## Resolution principles
1. Explicit item-level pricing context (for example a named brand/rate list) is more specific than a generic selected context.
2. A selected Rate List is the default pricing context for extracted lines when no more specific context is supplied.
3. Product, brand, specification, transaction purpose, quantity, transaction date/time, and applicable rate-list version must be considered.
4. Quantity tiers use the highest applicable tier for the requested quantity.
5. If no unambiguous rate exists, the system returns an unresolved pricing result; it must not invent a rate.
6. Manual rate override remains possible, but must be explicit and auditable.
7. The resolved result records its pricing source for explainability and audit.

## AI safety boundary
OCR, camera, voice, and AI extraction may propose structured line items and pricing context. They must not directly mutate financial records or bypass the deterministic Pricing Service.

## Reuse
The same Pricing Service will be consumed by estimates, quotations, sales invoices, purchases/vendor bills, returns, and inventory-related commercial flows. No document-specific pricing algorithms are permitted.

## Acceptance criteria
- Item + quantity + selected Rate List automatically resolves a rate.
- Item + quantity + explicit brand/rate context resolves the matching rate when unambiguous.
- Voice and image extraction use the same pricing resolver as manual entry.
- Missing/ambiguous rates produce an explicit unresolved state.
- Quantity tiers and effective-date versions are deterministic and tested.
- Every resolved rate identifies its source.
