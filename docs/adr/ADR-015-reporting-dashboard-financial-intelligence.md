# ADR-015 — Reporting, Dashboard & Financial Intelligence Foundation

## Status
Accepted

## Decision

Phase 11 establishes a canonical read-only reporting layer over authoritative ERP transactions. Reports and dashboards must derive from accounting, sales, purchases, inventory, receivables, and payables source-of-truth data; they must not create a second financial ledger.

The dashboard is a presentation of reporting projections, not a mutation boundary. Future AI analytics will consume the same reporting contracts and must not invent financial values or bypass authorization.

## Scope

- Financial reporting projections: trial balance, general ledger, profit-and-loss foundation, receivables, payables, cash position.
- Business reporting projections: sales, purchases, returns, payments, inventory/stock indicators.
- Dashboard KPI contracts and summary queries.
- Organization-aware filtering using Phase 10 authorization context.
- Read-only reporting service boundaries and regression tests.

## Non-goals

- No replacement of authoritative accounting transactions.
- No new Estimate/Invoice/Purchase/Sales mutation workflow.
- No OCR, camera, voice, or AI mutation path in this phase. Those features consume these reporting contracts later.
- No silent organization assignment of legacy data.

## Principles

1. One source of truth: transactions and ledger remain authoritative.
2. Reports are read-only and reproducible.
3. Organization scope is explicit; missing scope must fail closed.
4. Dashboard figures must reconcile to underlying report projections.
5. Financial calculations use database numeric/decimal semantics and avoid JavaScript floating-point mutation of money.
6. Every sensitive report is authorization-gated.
