# ADR-003: Estimate and Quotation are one commercial document

## Decision
MuradERP-AI will not maintain separate Estimate and Quotation entities.

Estimate and Quotation are two labels for the same non-posting commercial document. The database, lifecycle, pricing, totals, rent, cost analysis, layouts, print and WhatsApp behavior are shared.

## User experience
- The user may choose the document label `Estimate` or `Quotation`.
- Both labels use the same document record and number.
- `Create Invoice` converts the same non-posting document into an Invoice.
- An Estimate/Quotation never changes inventory, customer receivable, revenue, COGS or accounting.

## Invoice boundary
Invoice is the first authoritative sales transaction. Creating an Invoice executes one controlled transaction that updates inventory, receivables, revenue, COGS/profit and pass-through rent.

## Rationale
This matches the intended QuickBooks-style simplicity while avoiding duplicated domains and conversion logic. It also keeps the AI layer independent: OCR/voice/AI can create a draft of the same commercial document, after which normal ERP rules apply.

## Compatibility
Existing quotation-named TypeScript facades remain temporarily as aliases to avoid unnecessary breakage while callers migrate to the canonical Estimate domain. No new quotation database domain should be introduced.
