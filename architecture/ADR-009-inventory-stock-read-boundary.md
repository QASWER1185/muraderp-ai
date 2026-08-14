# ADR-009 — Inventory and Stock Read Boundary

## Decision

MuradERP-AI introduces an authenticated Inventory/Stock application boundary with read APIs for current warehouse balances and immutable stock movements.

## Rules

- Inventory balance is derived from persisted stock state and is never mutated directly by the read API.
- Stock movements are the audit trail for stock-affecting operations.
- Existing atomic purchase workflow remains authoritative for purchase-driven stock mutations.
- Future stock adjustments, transfers, sales and returns must use explicit application services and transaction boundaries.
- AI must not receive direct authority to mutate inventory.

## API surface

- `GET /api/v1/inventory/balances`
- `GET /api/v1/inventory/balances/:productId/:warehouseId`
- `GET /api/v1/inventory/movements`

All routes require the existing internal API bearer-token boundary.
