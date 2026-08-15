# ADR-022 — Phase 17B Estimate Pricing Integration

## Status
Accepted

## Decision
Estimates shall use the deterministic pricing engine to automatically resolve unit prices for AI/OCR/voice/manual line candidates whenever a valid selected rate-list context or explicit rate-list/brand hint is available.

AI may extract item, quantity, unit, and brand/rate-list hints, but it shall never directly mutate financial pricing. Ambiguous or unresolved pricing must remain explicit and require user resolution. Manual override remains supported and auditable.

## Flow
Input -> structured estimate line -> pricing context -> deterministic resolver -> priced estimate line -> estimate repository.

## Acceptance criteria
- Selected default rate list is propagated to estimate pricing.
- Explicit line rate-list selection takes precedence over the estimate default.
- Brand/rate-list hints are resolved through the controlled hint resolver.
- Quantity and effective-date rules remain owned by the deterministic pricing service.
- Missing or ambiguous rates are never fabricated.
- Manual price override remains supported.
- Pricing source/resolution metadata is retained.
- The same pricing path is usable for manual, OCR and voice-generated drafts.
