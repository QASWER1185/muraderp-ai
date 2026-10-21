# ADR-012 — Accounting Ledger & Financial Reporting Foundation

## Status
Accepted

## Context
MuradERP-AI now has authoritative purchase, sales, payment, and sales-return transaction boundaries. These workflows need a common accounting substrate without exposing direct journal mutation to clients.

## Decision
Use a modular-monolith accounting core with a canonical Chart of Accounts, immutable posted journal entries and lines, one database posting function requiring balanced non-zero double-entry lines, source identity/idempotency protection, and read-only General Ledger and Trial Balance projections.

Existing transaction services remain the owners of their business transactions and invoke the accounting boundary. Accounting is not a generic CRUD endpoint.

## Guardrails
- Every posted journal must balance total debits to total credits.
- A line cannot contain both debit and credit, and zero-value lines are rejected.
- Browser roles cannot directly mutate accounting tables.
- Source identity and idempotency prevent duplicate postings.
- AI may classify, explain, reconcile, or draft, but cannot directly post financial mutations.
- Financial reports are read-only projections over posted journal entries.

## Consequences
This establishes the foundation for customer/vendor ledgers, trial balance, profit and loss, balance sheet, cash flow reporting, period controls, and audit-ready financial reporting while keeping the system extensible for AI-assisted accounting workflows.
