# ADR-010 — Atomic Sales Transaction Boundary

## Decision

Invoice posting is the authoritative sales transaction. A single database transaction must atomically coordinate inventory reduction, stock movement audit, customer receivable, revenue, COGS, pass-through rent, journal entries, and optional estimate conversion.

## Rules

- Estimates and quotations remain non-posting documents.
- There is no separate user-facing "Post Invoice" mutation after invoice creation; the create-invoice action is the posting boundary.
- Every sales mutation requires an `Idempotency-Key` scoped to the internal API principal.
- Reuse of an idempotency key with a different request fingerprint is rejected.
- Insufficient stock aborts the entire transaction; no partial invoice, ledger, journal, or stock mutation may remain.
- Stock movement rows are immutable audit evidence of the invoice-driven stock decrease.
- COGS uses the persisted product purchase cost for this foundation; a future costing engine may replace that source behind the same transaction boundary.
- AI/OCR/voice layers may prepare invoice input but never receive direct database mutation authority.

## API

`POST /api/v1/sales/invoices`

Required header: `Idempotency-Key`

Authentication: existing internal bearer-token boundary.
