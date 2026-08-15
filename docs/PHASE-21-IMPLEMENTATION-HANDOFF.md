# MURADERP-AI — PHASE 21 IMPLEMENTATION HANDOFF

## Mission
Build the first complete end-user ERP product surface on top of the verified backend and database foundation. Do not rebuild prior phases.

## Source of truth
- Phase 21 ADR: `architecture/adr/ADR-025-phase-21-erp-product-completion.md`
- Existing ERP services and APIs
- Phase 17 deterministic pricing
- Phase 18 document intelligence
- Phase 19 transaction automation
- Phase 20 AI Business Copilot

## Execution order
1. Inspect existing frontend/application surface before adding new structure.
2. Establish protected application shell, session and organization context.
3. Build reusable API client, loading/error/empty states and form validation.
4. Deliver dashboard and navigation.
5. Deliver master data: customers, vendors, products, brands, warehouses.
6. Deliver inventory and stock views.
7. Deliver purchase, estimate, invoice, return and payment workflows through existing backend services.
8. Deliver rate-list/pricing UX without duplicating resolver logic.
9. Deliver accounting/reporting presentation.
10. Integrate Phase 20 Copilot entry points rather than creating another AI layer.
11. Add responsive/mobile behavior and production hardening.
12. Run focused tests, full tests, typecheck and build after each slice.
13. Final gate: branch CI green → PR → merge develop → post-merge develop CI green on exact merge commit.

## Safety
- Never write directly to Supabase from browser code using privileged credentials.
- Never duplicate pricing/accounting/inventory mutation rules in frontend code.
- Never bypass organization/permission checks.
- Never weaken existing idempotency or confirmation requirements.
- Do not mark Phase 21 complete until the full Definition of Done is satisfied.

## Founder interaction
Founder should not manually edit existing source files. Implementation must be made through complete file changes/commits and reported with exact verification results.
