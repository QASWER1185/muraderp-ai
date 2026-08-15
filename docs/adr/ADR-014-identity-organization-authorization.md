# ADR-014 — Identity, Organization, and Role-Based Authorization Foundation

## Status
Accepted

## Context

MuradERP-AI now has transactional ERP foundations for customers, vendors, products, inventory, purchasing, sales, returns, receivables, payables, and double-entry accounting. The next architectural boundary must protect those capabilities for real users and organizations before AI/OCR/voice workflows are exposed broadly.

The product is intended to support multiple companies/branches and role-based access while preserving backend authority and database isolation.

## Decision

1. Authentication establishes the authenticated principal; authorization is evaluated separately.
2. Organization membership is the primary tenant boundary. Business reads/writes must be scoped to an organization.
3. Roles map to explicit permissions; frontend visibility is not a security boundary.
4. Sensitive operations are authorized in the backend service/API layer and protected by database RLS where applicable.
5. System/owner capabilities and ordinary operational roles are explicitly distinguishable.
6. Existing transactional services remain authoritative. Identity/authorization wraps those services rather than creating parallel mutation paths.
7. AI, OCR, camera, and voice features will inherit the authenticated user's organization and permissions and will never bypass authorization or directly mutate financial/inventory state.
8. Auditability is required for permission-sensitive financial mutations.

## Initial role model

- Owner: full organization administration and business access.
- Admin: organization configuration and broad operational access, subject to owner-only controls.
- Accountant: accounting, receivables, payables, reports; no unrestricted organization administration.
- Manager: operational management and approvals allowed by explicit permissions.
- Sales: customer, estimates, invoices, sales-related workflows.
- Purchase: vendors, purchases, payables, purchase-related workflows.
- Inventory: products, stock, warehouses, inventory operations.
- Viewer: read-only access permitted by assigned permissions.

## Permission model

Permissions are explicit strings such as `customers.read`, `customers.write`, `purchases.create`, `purchases.approve`, `sales.create`, `payments.create`, `inventory.adjust`, `accounting.post`, and `reports.view`. The exact catalog is versioned with the implementation.

## Consequences

- Tenant isolation becomes a first-class invariant.
- Existing ERP modules can be secured without redesigning their transaction boundaries.
- AI-assisted workflows can safely operate as proposals within the user's organization and permission scope.
- More schema and integration work is required, but the security boundary is established before broad AI exposure.
