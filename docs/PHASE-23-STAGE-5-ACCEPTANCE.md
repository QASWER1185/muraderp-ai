# MURADERP-AI — Phase 23 Stage 5 Acceptance

## Scope
Deterministic Rate List / Pricing Regression.

## Acceptance Contract

1. Authoritative pricing resolution remains server-side and deterministic.
2. Candidate scope precedence is `CUSTOMER > VENDOR > GLOBAL`.
3. An explicitly selected rate list wins over contextual supplier/customer scope.
4. Within the winning candidate set, only effective `ACTIVE` versions are considered; the newest effective version wins.
5. Within the selected version, the highest `minimum_quantity` tier not exceeding the requested quantity wins.
6. No applicable deterministic price returns `null`; the system does not invent or silently choose an arbitrary price.
7. Multiple active rate lists at the winning scope are rejected as ambiguous rather than silently selected.
8. AI/OCR/voice inputs may select or suggest pricing context, but the pricing service remains the final deterministic authority and accepts no AI-supplied price override.
9. Existing rate-list storage remains backend-controlled through RLS and service-role access.

## Evidence

Automated regression coverage is in `backend/test/phase23-stage5-pricing.test.ts` and covers precedence, explicit selection, effective version selection, quantity tiers, ambiguity rejection, no-price behavior, and the AI/OCR/voice boundary.

Final acceptance is recorded only after PR review, CI, merge, and exact post-merge `develop` verification.
