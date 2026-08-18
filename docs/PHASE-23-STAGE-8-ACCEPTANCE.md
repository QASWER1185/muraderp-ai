# MURADERP-AI — PHASE 23 STAGE 8 ACCEPTANCE

## Scope
Performance / Reliability Checks.

## Audit Closure Rule
This is an acceptance-cleanup stage, not a new product-feature stage. Existing ERP and AI authoritative services remain unchanged unless measured evidence identifies a real production defect.

## Required Critical Paths
- Authentication/session path
- Copilot draft/confirm path
- Deterministic pricing resolution
- Major ERP reads
- Protected ERP mutations
- Representative concurrent Copilot planning load

## Verification Method
1. Run the existing backend regression suite and record the complete suite duration.
2. Record test-file coverage and measured durations for representative authentication/session, Copilot, pricing, ERP-read, and protected-mutation test groups.
3. Run backend typecheck.
4. Run the production build.
5. Review the measured evidence for regressions or materially abnormal execution time.
6. Do not apply optimization without evidence of a real bottleneck.
7. Preserve authorization, determinism, auditability, idempotency and correctness.

## Acceptance Rule
Stage 8 is PASS only when the required critical-path evidence is recorded, the existing regression suite is green, typecheck is green, production build is green, and no unresolved performance/reliability defect is identified.

## Evidence
The repeatable evidence harness is `scripts/stage8-performance.mjs` and the CI gate is `.github/workflows/stage8-performance.yml`.

## Status
IN VERIFICATION — awaiting the first complete Stage 8 CI evidence run.

## Boundary
Stage 9 backup/restore remains explicitly DEFERRED/PENDING and is not part of Stage 8 closure.
