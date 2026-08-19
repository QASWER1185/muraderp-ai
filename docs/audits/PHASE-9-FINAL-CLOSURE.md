# Phase 9 — Final Audit Closure

## Scope

Vendor Payables & Purchase Accounting Foundation.

## Active-audit findings fixed

1. Vendor-payment allocation validation previously accepted a mixed-vendor allocation when at least one purchase matched the selected vendor. The function now requires every referenced purchase to exist and belong to the selected vendor.
2. The same purchase could be repeated inside one allocation payload and fail later with a misleading idempotency/unique-violation error. Duplicate purchase IDs are now rejected deterministically.
3. Payments could exceed a purchase's remaining payable balance. The function now calculates posted allocations per purchase and rejects over-allocation.
4. Concurrent payments could race while calculating the remaining payable. Referenced purchase rows are locked before the remaining-balance check.
5. Idempotent replay is resolved before mutable business-state validation so a replay of the same request deterministically returns the original payment.

## Verification

- Existing Phase 9 API tests remain in `backend/test/vendor-payment.test.ts`.
- Production Supabase schema contains vendor payments, allocations, idempotency keys, vendor payable ledger, vendor payable balances, purchases, vendors, and accounting journal relations.
- A controlled Supabase runtime smoke test created a temporary purchase, posted a vendor payment, verified idempotent replay returns the same payment, verified over-allocation is rejected with `P0002`, and cleaned all temporary records.
- Existing Phase 9 accounting account codes `1000`, `1010`, `1090`, `1200`, `1300`, and `2000` are present.
- Purchase remains the authoritative inventory mutation boundary; AI/OCR/voice remain proposal-only and cannot directly post financial mutations.

## Closure rule

Final closure follows the project audit policy: findings → fixes → tests → CI → merge → post-merge verification → remediate any failure → 100% PASS → CLOSED.

Post-merge execution is treated as a verification gate, not a reason to invent a PASS without evidence.
