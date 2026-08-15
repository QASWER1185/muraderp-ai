# ADR-015A — Privacy-First Dashboard Landing Screen

## Status
Accepted

## Decision

The MuradERP-AI dashboard landing screen must not expose raw financial figures, totals, percentages, chart data, customer/vendor balances, or transaction amounts on initial load.

The landing screen presents only high-level heads/cards:

- Sales
- Purchases
- Receivables
- Payables
- Profit
- Loss

The initial API response contains only stable card identifiers and labels. No monetary value is included.

A user with `reports.view` must explicitly select a head to request its detail for a defined reporting period. The detail endpoint is authorization-gated and returns the requested figure/data only after that drill-down.

## Security rationale

The dashboard may be visible on a shared screen, counter PC, reception monitor, or temporarily unattended workstation. High-level labels provide useful navigation without immediately disclosing sensitive financial information to an unknown observer.

This is defense in depth, not a replacement for authentication or authorization. The backend remains authoritative: both overview and drill-down require the `reports.view` permission.

## UI rule

Do not render financial values in the default dashboard shell. Values, charts, breakdowns, and transaction-level details appear only inside the selected head's detail view after explicit user action.

## Future extension

The same privacy boundary applies to AI-generated dashboard summaries: AI may summarize authorized detail, but it must not bypass the reporting authorization layer or expose figures from the initial dashboard payload.
