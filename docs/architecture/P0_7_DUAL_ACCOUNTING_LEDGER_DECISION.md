# P0-7 Dual Accounting-Ledger Decision

Status: Acceptance candidate for Principal Architect review.

## Decision

MuradERP-AI will have one accounting truth and one operational truth per business event.

The authoritative operational source is the posted domain transaction (invoice, purchase, customer payment, vendor payment, credit note/return, purchase return, or an explicit inventory adjustment transaction). Mutable current-state aggregates such as `public.inventory` are not business-event truth.

The authoritative accounting source is exclusively:

- `public.accounts`
- `public.journal_entries`
- `public.journal_lines`

`public.accounting_journal_entries` and `public.accounting_journal_lines` are classified as LEGACY_NON_AUTHORITATIVE. No future production writer or financial report may depend on them after the controlled cutover.

## Why this model wins

The authoritative candidate journal has account foreign keys, source/idempotency concepts, POSTED state, line-side checks, a balance assertion, and is already the source used by `general_ledger` and `trial_balance`.

The legacy accounting journal uses free-form `account_code`, has no journal-level debit=credit enforcement, and is currently written by several operational RPCs. That creates a second accounting truth and can diverge from financial reporting.

## Posting boundary

Accounting is created when a transaction becomes financially POSTED, never when it is merely a draft.

A transaction that requires accounting must commit in one PostgreSQL transaction. The required effects are:

1. authoritative operational document/state;
2. operational subledger projection where applicable;
3. inventory movement/current-state update where applicable;
4. authoritative double-entry journal;
5. idempotency/source-link record.

If any required effect fails, all effects roll back.

No application orchestration may commit the operational transaction first and post accounting later as an eventually-consistent second truth.

## Source linkage

Every system-generated journal requires a deterministic source tuple:

`organization_id -> source_type -> source_record_id -> posting_kind -> journal_entry_id`

Because current operational IDs are predominantly bigint while `journal_entries.source_id` is UUID, the implementation migration must normalize the polymorphic source key. The decision requires a canonical textual source key rather than guessing UUID ownership or changing operational primary keys.

The primary posting is unique for a source tuple. Reversals have their own posting kind and an explicit link to the journal being reversed.

## Double entry

A POSTED journal may not exist unless:

- it contains at least two lines;
- every line is one-sided and positive on the populated side;
- total debit is greater than zero;
- total debits equal total credits.

The database posting boundary is the final authority for this invariant. Browser and ordinary authenticated callers must not insert or edit posted journal lines directly.

## Operational posting rules

### Sale

At posting, the invoice, inventory movement, receivable subledger, and GL journal are one atomic transaction.

Target accounting shape:

- Debit Accounts Receivable for total customer amount, including pass-through rent exactly once.
- Credit Sales Revenue for product revenue.
- Debit COGS for original posted cost.
- Credit Inventory for the same cost.
- Credit Rent Payable for pass-through rent when applicable.

No separate second debit to a rent receivable account is allowed when Accounts Receivable already contains that customer amount.

### Purchase

At posting, purchase receipt, stock movement, payable subledger, and GL journal are atomic.

Target accounting shape:

- Debit Inventory for net inventory cost.
- Debit Input Tax Recoverable where applicable.
- Credit Accounts Payable for the total payable.

### Customer payment

Payment, allocations, receivable subledger reduction, invoice settlement state, and GL journal are atomic.

- Debit Cash/Bank.
- Credit Accounts Receivable.

### Vendor payment

Payment, allocations, payable subledger reduction, and GL journal are atomic.

- Debit Accounts Payable.
- Credit Cash/Bank.

### Sales return / credit note

Credit note, returned inventory, receivable reduction, and GL reversal effects are atomic.

- Debit Sales Returns.
- Credit Accounts Receivable.
- Debit Inventory at the original posted cost basis.
- Credit COGS at the same original posted cost basis.

### Purchase return

A purchase return must be its own source transaction. It reverses the original receipt cost basis and the related payable/tax effect atomically. It must not be modeled as an unexplained stock decrement.

### Inventory adjustment

Quantity adjustment and accounting value adjustment must be one controlled transaction when the adjustment is financially valued. No costing method is selected by P0-7.

## Inventory costing

P0-7 does not choose FIFO, weighted-average, specific identification, or another cost method.

The live model has `stock_movements.unit_cost` and invoice-item cost capture but no explicit cost-layer/valuation architecture. Existing fallback behavior that uses `product.purchase_price` is implementation behavior, not an approved costing policy.

A separate costing decision is required before production inventory valuation is considered complete.

Returns must reverse the original posted cost basis, not recalculate using the current product purchase price.

## Customer and vendor balances

`customer_ledger_entries` is a derived receivable subledger projection.

`vendor_payable_ledger_entries` is a derived payable subledger projection.

Neither is an independent accounting truth. They are produced atomically from the same business source event as the GL journal.

Per-customer/per-vendor operational balances may be calculated from these subledgers, but:

- total customer receivable subledger must reconcile to GL Accounts Receivable control account `1100`;
- total vendor payable subledger must reconcile to GL Accounts Payable control account `2000`.

Financial statements use the authoritative GL, not the subledger projection.

## Financial reporting

General ledger, trial balance, balance sheet, profit/loss, and other financial statements derive exclusively from the authoritative `accounts` / `journal_entries` / `journal_lines` model.

Legacy `accounting_journal_*` rows are never merged into reports as a second truth.

Current `trial_balance` status filtering must be corrected or superseded during implementation. Under the target reversal model, corrections do not make historical posted lines disappear.

## Immutability, reversals, and corrections

Posted journal lines are immutable.

A correction never silently rewrites or deletes a posted journal. It uses:

1. a new posted reversal journal with exact inverse lines and an explicit link to the original journal;
2. a new corrected source transaction and/or corrective journal where required.

The original journal remains auditable.

Operational document status may change according to its lifecycle, but accounting history is preserved through additive reversal/correction entries.

## Idempotency

System-generated posting uses the same deterministic business-operation identity as the source transaction.

Required scope:

`organization_id + principal/operation scope + idempotency_key + request fingerprint`

A retry with the same fingerprint returns the existing source transaction and existing journal. Reuse with a different fingerprint is rejected.

A second primary journal for the same source tuple is rejected or returns the existing journal. Accounting does not create an independent competing idempotency namespace detached from the source transaction.

## Divergence prevention and reconciliation

Production readiness requires these invariants:

- every accounting-required POSTED source has exactly one primary authoritative journal;
- no primary authoritative journal exists without its source transaction;
- every posted journal balances;
- AR subledger total reconciles to GL account `1100` by organization;
- AP subledger total reconciles to GL account `2000` by organization;
- inventory value reconciles to GL account `1200` after the costing policy is approved;
- no new writes occur to legacy `accounting_journal_*` after cutover;
- financial reports never read the legacy journal.

## Targeted live findings driving the decision

1. Two journal models exist simultaneously.
2. `general_ledger` and `trial_balance` read `journal_entries` / `journal_lines` / `accounts`.
3. Operational RPCs including invoice posting, customer payment, purchase/payable, vendor payment, sales return, and invoice void currently write `accounting_journal_*`.
4. The live authoritative-candidate journal and both operational subledgers currently contain zero rows, allowing a clean future cutover without rewriting business accounting history in P0-7.
5. Current invoice/void legacy rent posting can be unbalanced when pass-through rent is non-zero.
6. Current `journal_entries.source_id` is UUID while operational IDs are bigint.
7. `SupabaseSalesTransactionRepository` calls `record_sales_transaction`, but the targeted live catalog contains no function by that name.
8. No explicit inventory cost-layer/FIFO/weighted-average table architecture is present.

## Implementation sequence after P0-7 acceptance

P0-7 itself creates no schema migration. A separately authorized implementation unit should:

1. extend the authoritative journal with organization-aware polymorphic source linkage and reversal linkage;
2. harden the posting API so balanced authoritative journals can only be produced atomically;
3. route sale/purchase/payment/return posting to the authoritative journal in the same transaction as operational effects;
4. stop all new legacy `accounting_journal_*` writes;
5. correct authoritative financial-report filtering and reconciliation rules;
6. resolve the missing `record_sales_transaction` repository path;
7. finalize inventory costing in a separate explicit decision before production valuation cutover;
8. only then retire/archive the legacy journal through a forward-only migration after migration provenance is unblocked.

## Production gate

Until the dual-ledger cutover is implemented and verified, production financial reporting is not allowed to claim completeness for operational transactions.
