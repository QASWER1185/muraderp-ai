# MuradERP-AI Master State

Canonical entry point

Last evidence audit and release verification: 2026-09-09 (Asia/Karachi)

Authoritative status: **AUDIT CLOSED — RELEASE CANDIDATE VERIFIED**

Verified release candidate: `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f`

Release-baseline parent: `e8aad251c67c2e54bc06e760fcb3fc0b948c5e9d`

Audited by: Codex, repository/workspace discovery, controlled baseline creation, and exact-commit verification

## Future session entry rule

Every future ChatGPT/Codex session must begin by reading, in order:

1. this file;
2. [`MURADERP-AI-PRODUCT-SCOPE.md`](MURADERP-AI-PRODUCT-SCOPE.md);
3. [`PRODUCTION-CLOSURE-STATUS.md`](PRODUCTION-CLOSURE-STATUS.md);
4. [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md);
5. only the relevant detailed ADR, audit, phase, or handoff documents needed for the task.

Then inspect the current Git branch, HEAD, and status before changing anything. Do not rely on the Git snapshot below after the repository changes.

Do not start another comprehensive audit. Areas recorded VERIFIED at the release-candidate commit are CLOSED/FROZEN unless a concrete regression, security finding, relevant code/schema change, or changed requirement invalidates their evidence. The next phase is **PRODUCTION CLOSURE**.

## Source-of-truth order

When evidence conflicts, use this order:

1. Current executable source, active migrations, database constraints/RPCs, and tests.
2. Current Git branch/HEAD/status and exact-commit CI/deployment evidence.
3. Accepted ADRs and explicit product-owner instructions.
4. Current canonical documents in this set.
5. Historical phase plans, handoffs, audits, acceptance notes, and README statements.

Historical documents are evidence of prior decisions and verification at their recorded revisions; they are not permission to mark the current worktree or production environment complete.

## Status vocabulary

- **AGREED**: approved product/architecture requirement.
- **IMPLEMENTED**: code or schema exists.
- **VERIFIED**: named evidence passed for the described revision/worktree.
- **PRODUCTION READY**: the accepted release scope is verified on a clean exact commit, deployed under controlled configuration, operationally observed, and recoverable.

These words are never interchangeable.

## Project identity and vision

MuradERP-AI is an original, AI-native ERP for building-material, electrical, sanitary, hardware, cement, steel, plumbing, bricks, and related trading businesses. It should make complex sales, purchasing, inventory, receivables/payables, accounting, and reporting usable by non-technical owners.

QuickBooks is a familiar workflow reference where helpful. MuradERP-AI is not a direct QuickBooks clone and is intended to add safe AI-native input, matching, pricing, review, and orchestration appropriate to the target businesses.

The founder/product owner is recorded in `README.md` as **Qaswer Hussain**.

## Non-negotiable requirements

- Manual ERP entry remains first-class; AI is optional.
- AI/OCR/voice/LLM output is untrusted proposal data and never direct database authority.
- Protected financial/inventory actions require deterministic validation, authorization, and explicit confirmation.
- Products remain canonical; brand/company/supplier pricing belongs to dynamic rate-list/document-line context.
- Missing, ambiguous, incompatible, cross-tenant, or unresolved pricing fails closed.
- One Estimate may contain mixed brands/rate lists. Clone/reprice never mutates the source and always previews before creation.
- Estimate/Quotation is non-posting; Invoice creation is the atomic sales posting boundary.
- Stock, receivable/payable, and accounting effects are atomic, auditable, source-linked, and idempotent.
- `accounts`/`journal_entries`/`journal_lines` are the authoritative ledger. Legacy `accounting_journal_*` is non-authoritative.
- Organization, branch, actor, permission, and service-principal context is explicit and enforced server-side/database-side.
- Secrets remain server-side; browser code cannot receive privileged Supabase/provider credentials or arbitrary SQL access.
- Offline mode captures/replays drafts only; the server remains financial/inventory truth.
- Database evolution is forward-only; historical migrations are never edited or blindly reapplied.
- Existing authoritative services are extended/reused; no parallel pricing, accounting, inventory, purchase, sales, or AI transaction engine.

Full scope classification is in [`MURADERP-AI-PRODUCT-SCOPE.md`](MURADERP-AI-PRODUCT-SCOPE.md).

## Current Git/workspace state

Workspace-stabilization snapshot (2026-09-09, Asia/Karachi):

- Branch: `p0-8-authoritative-accounting-posting-20260829`
- HEAD: `e81ac8aee85937d816cfaade6929b3eeeb046489`
- HEAD date/subject: `2026-08-30T10:21:28+05:00` - `fix(accounting): authorize invoice posting by sales permission`
- Upstream shown locally: `origin/p0-8-authoritative-accounting-posting-20260829`
- Local branch/upstream divergence: **0 ahead, 0 behind**. This is a local comparison only; no network fetch was performed.
- Index/staging area: **empty**.
- Dirty worktree: **76 modified, 35 deleted, 91 untracked; 202 entries total**. The normalized `git status --porcelain=v1 --untracked-files=all` path/status inventory has SHA-256 `75c9fd6856ba1dde33f87d98e5e9dd3764cf1cf2437fa330e1e431240f0d9d83` (UTF-8, LF, terminal LF).

| Workspace category | Modified | Deleted | Untracked | Total | Baseline disposition |
|---|---:|---:|---:|---:|---|
| A. Intentional product/application work | 38 | 0 | 6 | 44 | Preserve and include after review. |
| B. Tests/verification tooling | 28 | 0 | 13 | 41 | Preserve and include with the corresponding behavior. |
| C. Database/migrations/provenance | 10 | 35 | 67 | 112 | Preserve as one coordinated migration-provenance/canonicalization set; 104 entries are material deltas and 8 are normalization-equivalent status entries. |
| D. Canonical documentation | 0 | 0 | 4 | 4 | Preserve and include in the baseline. |
| E. Generated/build artifacts | 0 | 0 | 0 | 0 | Ignored `dist/` and dependency directories exist locally but are not part of the 202-entry inventory. |
| F. Temporary/local tooling | 0 | 0 | 1 | 1 | `.supabase-cli-home/telemetry.json` is generated local CLI state with device/session metadata; preserve for now but exclude from the baseline and add the directory to ignore rules before staging. |
| G. Unknown/unclassified | 0 | 0 | 0 | 0 | None found. |

The 201 release-source status entries comprise 193 material deltas plus 8 paths that Git status reports modified even though the clean-filtered content diff is empty: `supabase/migration-provenance/phase21-disposition.json`; migrations `20260809141445`, `20260813071425`, `20260824170000`, `20260828182231`, `20260829062845`, `20260829065058`, and `20260829173824`. Treat these eight as line-ending/index-normalization risk to reconcile without overwriting the working files; they are not independent application changes.

All 35 deleted historical migration paths have content-identical counterparts under `supabase/migration-history/precanonical/sql/`. The archive contains 36 SQL files because it also preserves the pre-change form of active migration `20260815163914`. The current executable chain contains 36 SQL migrations and passes the provenance validator. Do not restore the archived migrations to the active path or delete either half of this canonicalization set.

The important material workstreams beyond HEAD are: migration provenance/canonicalization; P0 authorization, actor/branch context, accounting and non-sales transaction convergence; Products security; Estimate mixed-brand pricing and clone/reprice; Copilot reference/runtime safety; corresponding backend/frontend/SQL tests; frontend integration; and this four-document canonical state set. No unrelated product feature or unexplained binary file was found in the dirty inventory.

This stabilization task changes canonical documentation only. It does not commit, stage, reset, clean, delete, revert, switch branch, rewrite history, or modify product behavior.

Controlled release-baseline staging snapshot (2026-09-09, Asia/Karachi):

- `.gitignore` now excludes `.supabase-cli-home/`; the existing telemetry file remains on disk and is ignored.
- The eight normalization-only paths were reconciled with an index-stat refresh after their raw worktree blob, clean-filtered blob, and index blob IDs were proven identical. Their file SHA-256 values did not change, they produce no staged diff, and no content was overwritten.
- The index contains **194 staged paths** when rename detection is disabled: 69 modified, 35 deleted, and 90 added. This is the 193 material MuradERP-AI paths plus the authorized `.gitignore` update.
- Normalized staged name/status manifest SHA-256: `38e5d2013da1b4713f553b24ce1ea3367f7a1a3dc4bc9dbde27e8fcafa1f2351` (UTF-8, LF, terminal LF; rename detection disabled).
- Staged diff summary: **12,271 insertions and 3,736 deletions**. Git may present the 35 historical migration moves as renames when rename detection is enabled; the no-renames accounting above is authoritative for path completeness.
- The working tree matches the index for every tracked path; there are zero non-ignored untracked files. No commit or push has occurred.
- The staged migration-provenance set is atomic: 28 active migrations added, one active migration modified, 35 old active paths removed, 36 precanonical SQL files archived, plus the archive README/manifest, canonical-chain manifest, and provenance validator. The resulting index has 36 active migrations and 36 archived SQL files.

Current verified release-candidate state:

- Branch: `p0-8-authoritative-accounting-posting-20260829`.
- HEAD: `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f` — `fix(security): align P0-6 principal validator with context boundary`.
- Parent/baseline commit: `e8aad251c67c2e54bc06e760fcb3fc0b948c5e9d` — `chore(release): establish MuradERP-AI baseline`.
- Worktree: **CLEAN** after exact-commit verification.
- Remote push: **NOT PERFORMED**. The local branch is two commits ahead of its configured upstream reference.
- The P0-6 release-candidate correction changes only `scripts/validate-p0-6-service-principal-foundation.mjs`; no application runtime code, migration, or SQL regression file changed in that correction.

## Current implementation state

### Verified at release candidate `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f`

The exact-commit verification reports:

- Backend: **83 Vitest files / 400 tests PASS**; TypeScript typecheck PASS; production build PASS.
- Frontend: **6 Vitest files / 18 tests PASS**; typecheck/syntax PASS; production build PASS.
- P0-6 validator PASS; P0-6 focused tests **5/5 PASS**.
- Stage 11 release readiness PASS.
- Production dependency audit at high threshold PASS.
- Private-key scan and concrete-credential scan PASS.
- `git diff --check` PASS.
- Migration provenance PASS; P0-7 accounting-decision validator PASS; P0-8 authoritative-posting validator PASS.
- A clean local replay applied all **36 active migrations**; the migration ledger latest version is `20260907120000`.
- On the required fresh replay, non-sales convergence, Estimate conversion, Products final-gate, and P0-8 authoritative-accounting SQL regressions all PASS.

Current locally verified backend boundaries include:

- environment validation, error handling, structured/redacted logging, and health/readiness diagnostics;
- browser session bootstrap/logout plus internal/service-principal authentication boundaries;
- organization membership, branch access, RBAC, ownership, and browser-role restrictions;
- organization-scoped Customer, Vendor, Brand, Product, Warehouse, Inventory, and Purchase APIs;
- versioned Rate Lists and deterministic price resolution;
- non-posting Estimate/Quotation services, atomic Estimate creation, mixed-brand line pricing, and clone/reprice preview-confirm execution;
- atomic Invoice/sales posting through the authoritative journal;
- atomic Purchase/AP, Customer Payment/AR, Sales Return, and Vendor Payment/AP paths;
- stock balance/movement read boundaries and transaction-created stock movements;
- authoritative Chart of Accounts, balanced immutable journal, General Ledger, and Trial Balance foundations;
- Copilot draft/confirm audit and authoritative Estimate/Invoice/Purchase/Return execution with deterministic reference and authorization checks.

The verified Rate List and Estimate foundation is CLOSED/FROZEN. It supports deterministic line-level pricing, mixed-brand pricing, controlled target-rate-list repricing, preserve-line-brand-context, clone/reprice preview, pricing provenance, pricing revalidation, atomic persistence, tenant/branch authorization, and idempotency. Conversions such as Popular → Dura → Company C → Company D are supported when the corresponding target Rate Lists exist. Production Closure must extend this foundation, not rebuild or fork it.

Detailed per-area status, evidence, gaps, and closure conditions are in [`PRODUCTION-CLOSURE-STATUS.md`](PRODUCTION-CLOSURE-STATUS.md).

### Implemented but not fully verified as an end-user/production capability

- Inventory intelligence query/adjustment-draft contracts; Copilot authoritative inventory adjustment remains deliberately unavailable.
- Reporting/dashboard service contracts; no reporting router is mounted and the UI has no live drill-down.
- AI input/document-intelligence contracts, validation, review lifecycle, and tests; current generic pipeline includes in-memory/no-op infrastructure and no production OCR/speech provider.
- Natural-language assistant contracts/resolver/service; no production assistant route/provider UI is mounted.
- Copilot UI/API for structured IDs and one-line draft input; not the full conversational voice/image/matching experience accepted in Phase 22.
- Offline service worker and durable draft outbox; contract/static tests pass, but current real-browser offline/reconnect E2E evidence is absent.
- Estimate rendering/printing/share and WhatsApp delivery-intent model; no provider-backed WhatsApp delivery or demonstrated PDF storage/delivery lifecycle.
- CI, configuration, secret, observability, and release-readiness controls are exact-commit verified locally; remote CI, deployment, and operational evidence remain Production Closure work because the release candidate has not been pushed or deployed.

### Remaining or blocked

- Complete manual frontend workflows for master data, purchases, estimates, invoices, returns, payments, Rate Lists, accounting, and reporting. Most current navigation pages render `generic()` placeholders.
- Production OCR/vision, speech-to-text, and LLM adapters plus secure source-media/audit storage and extraction review UX.
- Full WhatsApp transport, delivery audit/retry, and any inbound integration policy.
- Bank-feed/reconciliation schema reconciliation: service/repository code exists, but the active 36-migration chain does not create its referenced bank/reconciliation tables.
- Costed/accounting-safe Inventory Adjustment execution through manual/Copilot UI.
- Purchase-return and invoice reversal/void authoritative workflows where required. Current invoice void is fail-closed after ledger cutover.
- Customer credits/refunds/deposits/unapplied receipts, which were explicitly deferred by the payment decision.
- Explicit inventory-costing decision beyond the current persisted product-cost foundation before complete production valuation claims.
- Phase 23 Stage 9: actual isolated backup/snapshot restore and post-restore verification.
- Remote CI confirmation, controlled deployment, and deployed smoke/rollback evidence for the verified release candidate.
- Professional Estimate and Invoice document implementation: business branding/logo, customer details, document number/date, item table, quantity, rate, applicable discount/tax, subtotal, grand total, notes/terms, authorization/signature, A4/print layout, PDF output, and WhatsApp-ready PDF.

## Current production-readiness state

**AUDIT CLOSED — RELEASE CANDIDATE VERIFIED. The whole product is NOT YET PRODUCTION READY; proceed to PRODUCTION CLOSURE.**

This does not invalidate verified module behavior. It means the whole-product release claim is not supported because:

1. recovery Stage 9 is still open;
2. the active bank schema conflicts with the Phase 16 repository/closure record;
3. most ERP screens remain placeholders;
4. production OCR/voice/LLM/WhatsApp transports are absent;
5. no concrete deployment target/manifest or deployed release-candidate smoke evidence was found.

No reliable completion percentage is reported. Product requirements are not frozen into a weighted checklist, and backend verification, end-user completeness, deployment, and operational recovery have materially different states. Do not derive percentages from phase numbers, test counts, or historical "100%" labels.

## Historical phase and handoff recovery

The following document groups were recovered and remain useful, subject to the evidence hierarchy above:

- Foundation/current overview: `README.md`, `docs/PRODUCT_VISION.md`, `docs/MURADERP_AI_ARCHITECTURE_BLUEPRINT.md`.
- Pricing/Estimate/Sales decisions: ADR-003 and ADR-007 through ADR-010, ADR-022, and `ADR-ESTIMATE-INVOICE-POSTING-MODEL.md`.
- Finance/security/reporting decisions: ADR-011 through ADR-015A and P0-7.
- AI/inventory/document/bank decisions: ADR-016 through ADR-024.
- Product/AI/closure decisions: ADR-025 through ADR-027.
- Phase handoffs: Phase 18, 19, 20, 21, and 22 implementation handoffs.
- Earlier status/acceptance records: Phases 1, 2, 8-17 and their audit/closure documents.
- Phase 23: final closure plan, execution tracker, and Stage 3-13 evidence documents.
- P0 recovery/security evidence: P0-1/P0-1R migration provenance, P0-2 Phase 21 disposition, P0-3 data ownership, P0-5 branch/membership, P0-6 service principal, P0-7 ledger decision, and P0-8/non-sales convergence source/tests.
- Frontend-specific handoffs: `frontend/phase22-*`, `frontend/PHASE22-NOTE.md`, and `frontend/README.md`.

### Historically recorded closures

Historical documents record accepted/closed foundations for accounting, vendor payables, authorization, offline/AI input, inventory intelligence, document intelligence, deterministic pricing, transaction automation, and most Phase 23 stages. These records remain evidence for their exact historical commits.

They do **not** automatically close the current worktree or broader product journey. In particular:

- Phase 19 explicitly closed the transaction-automation **foundation**, not every downstream executor.
- Phase 21/22 definitions of done require complete ERP and text/voice/image UI journeys that current source does not provide.
- Phase 23 Stage 9 is explicitly deferred/pending.
- Phase 23 Stage 13's own file remains at "post-merge verification," not PASS/FINAL/CLOSED.

## Important historical decisions

The concise authoritative index is [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md). Particularly important:

- modular monolith;
- deterministic dynamic Rate Lists;
- unified non-posting Estimate/Quotation;
- Invoice as atomic sales posting;
- authoritative `journal_*` ledger and legacy `accounting_journal_*` classification;
- multi-organization/branch/RBAC defense in depth;
- provider-neutral AI and mandatory confirmation;
- privacy-first dashboard;
- offline draft capture only;
- forward-only migrations and evidence-driven closure.

## Contradictions and uncertainties

1. `README.md` is materially stale: it says auth, organization isolation, estimates, invoices, AI, and offline sync are unverified, while current source/tests implement several of those foundations.
2. Phase 21/22/27 prose implies a complete production UI/AI experience, but current frontend source has placeholder module pages and no voice/image provider UX.
3. Phase 16 closure says bank persistence was applied, but the active clean migration chain has no bank/reconciliation tables required by the repository.
4. P0-7 still says "acceptance candidate" although later active migrations implement its authoritative `journal_*` direction.
5. Two ADR files use number 024.
6. Stage 9's document reports a 22-migration baseline; current active chain contains 36 migrations.
7. Stage 13 records a merge but still requires post-merge verification; no later canonical Stage 13 PASS record was found.
8. Historical CI evidence applies only to its recorded commits; the current authoritative local release evidence is the exact-commit verification at `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f`.
9. Supabase Realtime image `public.ecr.aws/supabase/realtime:v2.129.3` crashes with SIGILL/exit 132 on this host because its Intel i5 M520 CPU does not expose the required AVX/AVX2 instructions. This occurs during the Realtime BEAM seed before MuradERP migrations begin. Temporarily disabling Realtime locally allowed `supabase db reset --local --no-seed` to replay all 36 migrations; Realtime configuration was restored afterward. This is a local environment limitation, not an application or migration defect. Never commit a Realtime-disabled production configuration.

## Known risks

- A future agent may trust optimistic phase labels and unintentionally skip current UI/schema/operational gaps.
- Restoring archived historical migrations to the active chain would undo the verified migration-provenance baseline.
- Legacy and authoritative journal tables coexist; a new legacy writer would recreate accounting divergence.
- Provider/integration claims can be overstated because adapter contracts and unit tests exist without production transports.
- Static frontend tests verify source markers more than real user journeys.
- Production schema may differ from the active canonical chain until pending migrations are deliberately applied and compared.
- The absence of isolated restore proof means recoverability is unknown.

## Anti-repeat rule

The audit is CLOSED. Do not re-audit or rebuild a VERIFIED area from scratch unless one of these is true:

- relevant code changed;
- relevant schema/migration changed;
- a regression or failing gate appeared;
- production verification invalidated the evidence;
- new scope changes the acceptance contract.

When re-verification is needed, start from the exact evidence and closure condition recorded in `PRODUCTION-CLOSURE-STATUS.md`.

## Evidence references

- Product intent: [`PRODUCT_VISION.md`](PRODUCT_VISION.md)
- Enterprise architecture: [`MURADERP_AI_ARCHITECTURE_BLUEPRINT.md`](MURADERP_AI_ARCHITECTURE_BLUEPRINT.md)
- Architecture index: [`ARCHITECTURE-DECISIONS.md`](ARCHITECTURE-DECISIONS.md)
- Active migrations: [`../supabase/migrations`](../supabase/migrations)
- Migration provenance: [`../supabase/migration-provenance`](../supabase/migration-provenance)
- Database tests: [`../supabase/tests`](../supabase/tests)
- Backend tests: [`../backend/src`](../backend/src) and [`../backend/test`](../backend/test)
- Frontend implementation/tests: [`../frontend`](../frontend)
- CI workflows: [`../.github/workflows`](../.github/workflows)
- Phase 23 tracker: [`PHASE-23-EXECUTION-TRACKER.md`](PHASE-23-EXECUTION-TRACKER.md)
- Backup/restore status: [`PHASE-23-STAGE-9-BACKUP-RESTORE-READINESS.md`](PHASE-23-STAGE-9-BACKUP-RESTORE-READINESS.md)

## Current recommended next action

Begin **PRODUCTION CLOSURE** from verified release candidate `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f`. Do not reopen the closed audit or rebuild the verified pricing/Estimate foundation. Production Closure execution must address only genuinely incomplete production requirements:

1. AI Copilot production experience;
2. text → ERP data;
3. voice → ERP data;
4. image/OCR → ERP data;
5. file attachment → ERP data;
6. AI-assisted Estimate creation;
7. AI-assisted Invoice creation;
8. AI-assisted Rate List entry/import;
9. mandatory confirmation before consequential ERP actions;
10. Dynamic Rate Lists and deterministic pricing product workflows built on the verified foundation;
11. brand/company target Rate List conversion workflows;
12. professional Estimate and Invoice documents, A4/print/PDF output, and WhatsApp-ready PDFs;
13. provider-backed WhatsApp PDF sending with delivery audit/retry;
14. remaining core ERP production workflows;
15. inventory and reporting where genuinely incomplete;
16. offline/recovery requirements;
17. bank-schema reconciliation and other recorded integrity blockers;
18. backup/restore proof;
19. deployment configuration and remote exact-commit CI;
20. final deployed smoke and rollback checks.

Do not claim these capabilities complete until their implementation and production evidence satisfy the closure conditions in `PRODUCTION-CLOSURE-STATUS.md`.

## CURRENT RESUME POINT

**Complete:** **AUDIT CLOSED. RELEASE CANDIDATE VERIFIED.** Commit `b60eaa9ba69eedc5dda6e268f87d11fa7eb0f46f` passed the recorded backend, frontend, security, migration, and fresh-replay SQL gates. The worktree was clean after verification, and nothing was pushed.

**Currently being worked on:** Documentation continuity only. No product implementation is authorized by this update.

**Next exact task:** Start from **PRODUCTION CLOSURE**. The remaining AI/Copilot/Voice/Image/File/Rate-List/PDF/WhatsApp/core ERP work is the next execution scope. Do not re-audit verified work.

**Must NOT be changed:** Do not rewrite or bypass the verified release-candidate baseline; do not restore archived historical migrations into the active chain; do not create parallel pricing/accounting/inventory/Copilot engines; do not weaken organization/branch/RBAC/idempotency/confirmation boundaries; do not mark provider contracts or placeholder UI as production complete.

**Read first next session:**

1. `docs/MURADERP-AI-MASTER-STATE.md`
2. `docs/MURADERP-AI-PRODUCT-SCOPE.md`
3. `docs/PRODUCTION-CLOSURE-STATUS.md`
4. `docs/ARCHITECTURE-DECISIONS.md`
5. the relevant P0/ADR/handoff documents only as needed
6. current `git status`, branch, and HEAD before any change
