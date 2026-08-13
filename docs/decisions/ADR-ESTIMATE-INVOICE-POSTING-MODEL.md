# ADR: Estimate and Invoice Posting Model

## Decision

MuradERP-AI will use two primary sales documents for the customer-facing sales workflow:

1. **Estimate** — a non-posting commercial planning document.
2. **Invoice** — a posting sales transaction.

An Estimate does not affect inventory, customer receivables/ledger, revenue, COGS, or accounting balances.

When the user selects **Create Invoice** from an Estimate, the system creates the Invoice and executes its business effects as one controlled transaction.

A user-visible **Post Invoice** step is intentionally not required.

## Direct Invoice

Invoices may also be created directly without an Estimate. Direct invoices use the same invoice transaction pipeline and therefore have the same inventory, receivable, revenue, COGS, profit/loss, and pass-through-rent behavior.

## Transaction boundary

Internally, invoice creation remains separated into application/domain operations so that validation, pricing, inventory, receivable, COGS, accounting and audit rules stay testable. However, these operations are orchestrated as one atomic invoice transaction from the user's perspective.

If any required business effect fails, the invoice transaction must fail as a whole rather than leaving a partially applied sale.

## Estimate conversion

Estimate -> Invoice is a conversion, not an accounting posting of the Estimate. The Estimate remains historical/non-posting and retains its identity as the source document.

## Profit and Loss

The Estimate may show **expected** cost, expected profit/loss and margin. The Invoice records the authoritative sale and actual inventory/COGS basis used for accounting profit/loss.

## Pass-through rent

Rent collected from the customer for a driver/vehicle/loader remains part of customer payable but is not treated as business sales revenue. It is recorded as a pass-through amount/payable according to the accounting configuration.

## UX principle

The primary sales actions should remain simple:

- Save Estimate
- Create Invoice
- Save Direct Invoice
- Print / Share

Advanced transaction orchestration stays inside the application architecture and is not exposed as an unnecessary accounting button.
