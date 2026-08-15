# ADR-013 — Vendor Payables, Purchase Accounting, and AI-Assisted Purchase Input

## Status
Accepted

## Context

MuradERP-AI already has an authoritative purchase transaction boundary that records purchase, purchase items, inventory movement, and stock balance atomically. It also has double-entry accounting, customer receivables, payments, and sales returns.

The next financial capability is the supplier-side lifecycle: purchase/bill -> accounts payable -> vendor payment -> purchase return -> accounting.

The target businesses also need a low-friction purchase capture workflow. A purchase request may originate from typed text, a photographed/handwritten page or invoice, or voice. Users should not be forced to retype the same information into ERP forms.

## Decision

1. Vendor payables and purchase accounting are built as a domain layer above the existing authoritative purchase transaction; the purchase transaction remains the sole stock-mutating boundary.
2. AI/OCR/voice inputs are treated as untrusted proposals. They may extract or normalize vendor, products, quantities, units, prices, dates, references, taxes, and notes, but they may not directly post a purchase or accounting entry.
3. Every AI-assisted proposal must preserve source type, raw source reference where available, extraction confidence, normalized fields, validation errors, and human approval state.
4. Low-confidence or ambiguous vendor/product/rate matches require human confirmation before posting.
5. Once confirmed, the proposal is converted into the existing typed purchase command and passed through the authoritative purchase service. No parallel purchase mutation path is introduced.
6. Vendor payable, vendor payment, purchase return, and their accounting consequences must be atomic, idempotent, auditable, and reversible only through explicit business transactions.
7. Camera/image and voice capability are represented by provider-neutral application contracts so concrete AI/OCR providers can be integrated later without changing accounting boundaries.

## Consequences

- Users can eventually say or show what they need purchased instead of manually retyping every line.
- AI can improve speed without becoming an accounting authority.
- Original source and corrections remain auditable.
- The same canonical product/rate-list resolution logic is reused for manual and AI-assisted purchase entry.
- More implementation is required for confidence scoring, source storage, approval UX, and provider integrations, but financial integrity is protected.
