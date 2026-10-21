# MURADERP-AI — PHASE 23 STAGE 3

## ERP Data Integrity & Transaction Consistency

Stage 2 is complete and merged. Stage 3 is now the active controlled workstream.

### Objective
Verify that authoritative ERP workflows cannot produce partial, duplicated, cross-context, or financially inconsistent state.

### Mandatory verification areas
- Customer/vendor/product/brand master-data integrity
- Warehouse and inventory consistency
- Purchase posting consistency
- Estimate-to-invoice consistency
- Sales/invoice posting consistency
- Returns and reversal consistency
- Customer payment consistency
- Vendor payment consistency
- Accounting journal consistency
- Inventory/accounting atomicity where required
- Organization and branch context propagation through mutations
- No partial mutation on failed workflow
- Existing idempotency and duplicate protection
- Auditability of protected mutations

### Architectural boundary
No new domain engine is permitted. Existing authoritative ERP services remain the source of truth. Pricing remains governed by the deterministic Rate List resolver. Accounting remains governed by the authoritative ledger boundary. Copilot may orchestrate but cannot bypass these services.

### Acceptance gates
1. Add focused regression tests for each critical consistency boundary.
2. Reproduce any existing defect before changing production code.
3. Fix only verified defects or missing enforcement.
4. Run backend typecheck/tests/build.
5. Run frontend syntax verification where affected.
6. Run production security gate.
7. Review migration impact before any database change.
8. Merge only after all required CI is green.
9. Verify exact post-merge develop SHA and CI.

### Stage 3 Definition of Done
Stage 3 is PASS only when critical ERP integrity scenarios have actual automated/regression evidence and the exact merged `develop` commit is green. CI-green alone is insufficient.
