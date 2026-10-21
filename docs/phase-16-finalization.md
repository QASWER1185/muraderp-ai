# Phase 16 — Bank Feeds & Bank Reconciliation Foundation

## Finalization contract

1. Bank feed rows are normalized before persistence.
2. `(organization_id, bank_account_id, external_id)` is the idempotent transaction identity.
3. Reconciliation sessions are explicitly bounded by account and period.
4. Match suggestions are advisory and require explicit human confirmation.
5. Confirmed matches are persisted as reconciliation evidence; they do not directly post to the ledger.
6. Existing accounting services remain the only financial mutation boundary.
7. Bank credentials/secrets are never persisted in these tables.
8. Public, anonymous, and authenticated Data API writes are denied; the privileged ERP repository is the controlled mutation boundary.
9. Completion requires unit tests, typecheck, build, CI, PR merge, and post-merge `develop` CI success.
