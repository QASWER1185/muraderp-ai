# Local Copilot recovery — 18 October 2026

Baseline: `bb9a085c6110cdb7b9aadbdeaedc4626aa12bec7`, branch `feature/copilot-multimodal-phase2d`.

## Discovery and preservation

Reviewed all local/remote-tracking branches, 30 reflog entries, both stashes, Git worktrees and unreachable objects. The three unreachable commits (`c4c1795c8dbd`, `63a88a133b5d`, `6369d77cd359`) belong to the August `phase5-local-work-safe-backup` stash family, rather than a new lost Copilot implementation. They now have local `refs/recovery/copilot-scan/*` references and a verified standalone Git bundle. Neither stash was popped or dropped.

The disk search covered the dated folders under `C:/Users/My PC/Documents/Codex/`, excluding generated dependency/build directories. It identified 75 historical candidate source trees plus the current baseline and recovery copy. Feature-related comparisons covered 7,151 historical file occurrences. Twenty-four exported patches/diffs and 194 distinct differing source versions were preserved, with original locations and normalized-content SHA-256 hashes. Additional SQL migration variants and named estimate/invoice helper scripts were included. Original checkouts were not reset or cleaned.

Key sources:

- `C:/Users/My PC/Desktop/muraderp-ai`: actual uncommitted `frontend/copilot-ui.js`, `frontend/copilot-customer-flow.test.js`, `backend/src/ai-copilot/agent/agent.ts`, `erp-tools.ts`, provider-policy code and browser/provider regression tests. The checkout also contains customer confirmation work committed on the separate Phase 1 branch; not every recovered line was uncommitted.
- `C:/Users/My PC/Documents/Codex/2026-10-03/we-now-have-an-independent-repository/work/repo`: 12 uncommitted files, including `backend/src/services/entity-search.service.ts`, its tests, `backend/src/ai-copilot/agent/business-tools.ts` and its tests.
- `C:/Users/My PC/Documents/Codex/2026-10-12/muraderp-ai-move-forward-to-a/work/pilot-v4-next`: `backend/src/ai-input/document-numbers.ts`, document review/knowledge and report adapters, related tests, and two experimental SQL migrations.
- `C:/Users/My PC/Documents/Codex/2026-10-10/muraderp-ai-resume-copilot-live-debugging/work/full-release/source`: a staged release candidate with overlapping customer/provider/document work; source variants and its tracked code diff were preserved.
- Exported patches also survived in the October 3, 8, 9, 10 and 17 session folders. Their exact paths are recorded in `exported-patches-manifest.json` in the recovery archive.

## Integrated into the current architecture

1. Restored customer details collection and customer draft review in the unified chat. `prepare_customer_create` validates strict name/phone/city fields, checks customer-write permission and branch access, and calls the existing approval-draft runtime. The user must separately confirm before the existing ERP execution and verification flow creates a customer. Phone numbers retain leading zeroes. Preparation and confirmation are bound to the original user and workspace.
2. Restored conservative Roman Urdu rate-query cleanup before the indexed product-search RPC. It preserves size/unit qualifiers and ambiguity rather than reverting to the old full-catalog search.
3. Restored the requirement that inventory/margin product IDs come from a verified conversation reference. Signed comparison references are re-established before follow-up reads.
4. Adapted Urdu/Arabic numeric-field and ISO-date normalization to the current multimodal input contract. Product codes/dimensions remain unchanged; illegible values become null with warnings and require source review. Observed document prices/totals still do not become authoritative ERP inputs.
5. Recovered local-only commit `0f14d0f3bcdd038e24b206935a83c6dc003b19d5` from the October 3 independent repository. Its Gemini extraction adapter uses a single isolated native `erp_proposal` response and strict nested schema validation. The original commit is preserved in a Git bundle and local `refs/recovery/copilot-scan/gemini-native-proposal`; its changes were adapted without overwriting current user-key/provider tests.

The current multi-line estimate calculator, active-rate pricing, signed draft state and image/PDF/voice pipeline remain in use. Older snapshot implementations were not copied over these newer components. Guarded rate-list imports and persistent document-knowledge experiments were preserved rather than activated: they depend on two additional experimental migrations and a different review/token API. No historical migration was overwritten and no cloud schema was changed.

## Verification

The recovered customer form tests, customer preparation/authorization tests, numeric-field normalization tests, Gemini proposal validation tests, and recovered product-search/reference tests exercise these integrations. Final stable checks: 141 backend test files / 941 tests passed, TypeScript check and production build passed; 40 frontend test files / 180 tests passed, 48-module syntax gate and 50-asset production build passed; all 6 disposable SQL regression scripts passed after applying 44 migrations. No live customer, estimate, auth-user or payment mutation was performed during recovery.

The recovery archive and location/hash manifests are local deliverables under the current chat's `outputs/` directory; they are not added to the application repository because they include historical business source and local diagnostic material.
