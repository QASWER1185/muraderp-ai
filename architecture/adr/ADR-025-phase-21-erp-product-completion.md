# ADR-025 — Phase 21 ERP Product Completion & Production UI

## Status
Accepted / Architecture Locked

## Decision
Phase 21 converts the verified MuradERP-AI backend, database, accounting, inventory, pricing, transaction automation, and AI foundations into a coherent end-user ERP product. It does not rebuild Phases 17–20 or replace their authoritative services.

## Objective
Deliver the first complete, usable ERP product surface for building-material, electrical, sanitary, hardware, cement, steel, and plumbing businesses.

## Scope
- Production-grade web application shell and navigation
- Dashboard and business KPIs
- Customers, vendors, products, brands and warehouses
- Inventory and stock-movement views
- Purchase and sales workflows
- Estimates and invoices
- Returns and payments
- Rate-list management and pricing context
- Accounting and core reports
- Authentication, organization/branch context and role-aware UI
- AI Assistant/Copilot entry points using existing Phase 13/20 contracts
- Print/PDF/share-ready document presentation boundaries
- Responsive/mobile-first usability
- Error, loading, empty and permission states

## Architectural rules
1. Existing authoritative ERP services remain the source of truth for financial and inventory mutations.
2. Phase 17 deterministic pricing remains the pricing authority.
3. Phase 18 document intelligence remains the reusable extraction boundary.
4. Phase 19 transaction automation remains the transaction orchestration boundary.
5. Phase 20 Copilot remains the AI business orchestration boundary.
6. UI code must not contain duplicated accounting, inventory, pricing, or transaction business rules.
7. Organization, branch, user and permission context must be explicit at every protected workflow boundary.
8. Manual entry remains first-class; AI is an accelerator, not a prerequisite.
9. All mutation flows must preserve existing idempotency, validation, audit and authorization controls.
10. No direct browser access to Supabase secret/service credentials.

## Delivery slices
- 21-A application shell, auth/session context and protected navigation
- 21-B dashboard and reusable UI/data-state primitives
- 21-C master-data workflows
- 21-D inventory and warehouse workflows
- 21-E purchase/sales/estimate/invoice workflows
- 21-F returns/payments/accounting workflows
- 21-G pricing/rate-list UX
- 21-H reports and document presentation
- 21-I Copilot/AI entry-point integration
- 21-J responsive/mobile UX and production hardening

## Non-goals
- Rebuilding AI foundations
- Rebuilding deterministic pricing
- Rebuilding transaction automation
- Offline sync (planned after online product stability)
- Advanced predictive BI
- Provider-specific AI business logic in the UI

## Definition of Done
Phase 21 is complete only when the major ERP workflows are usable through the production UI, authorization/organization boundaries are verified, existing authoritative backend services are exercised without duplicated business logic, automated tests/typecheck/build pass, branch CI is green, PR is merged to develop, and post-merge develop CI passes on the exact merge commit.
