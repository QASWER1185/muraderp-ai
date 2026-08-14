# ADR-011 — Customer Payments & Receivables Transaction Boundary

## Status
Accepted

## Context
Invoice posting creates the customer receivable. A subsequent payment must reduce that receivable without allowing duplicate retries, overpayment, cross-customer allocation, or partial financial posting.

## Decision
Customer payment is an authoritative financial transaction implemented as one PostgreSQL transaction through `record_customer_payment`.

The transaction atomically:

1. validates the customer and invoice ownership;
2. validates allocations against each invoice's outstanding balance;
3. creates the payment;
4. creates invoice allocations;
5. updates invoice status to POSTED, PARTIALLY_PAID, or PAID;
6. creates the customer ledger PAYMENT credit;
7. creates the accounting journal entry and cash/bank → accounts receivable lines;
8. records principal-scoped idempotency completion.

The API requires `Idempotency-Key` and passes a deterministic request fingerprint to the transaction boundary.

## Overpayment policy
Payment allocation must equal the payment amount and cannot exceed invoice outstanding balance. Unallocated or excess customer cash is intentionally deferred until a separate customer-credit/deposit domain is designed with explicit accounting semantics.

## AI boundary
AI may prepare or suggest a payment draft, but it cannot post the payment or mutate receivables directly. Final posting must use the same validated application service and database transaction as non-AI entry.

## Consequences
- Financial consistency is preserved across payment, invoice, ledger, and journal state.
- Retried API requests are safe when the same principal, operation, idempotency key, and request fingerprint are reused.
- Future payment methods can be added without changing the accounting boundary.
- Customer credits, refunds, and unapplied receipts remain explicit future domains rather than hidden side effects.
