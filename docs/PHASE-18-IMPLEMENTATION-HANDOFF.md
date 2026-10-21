# MURADERP-AI — PHASE 18 IMPLEMENTATION HANDOFF

## Mission
Implement the centralized AI-Assisted Document Intelligence layer on top of the verified `develop` baseline. Do not rebuild Phase 17 pricing or any existing ERP domain module.

## Baseline
- Base branch: `develop`
- Feature branch: `feature/phase-18-ai-document-intelligence`
- Phase 17-A: Dynamic Pricing / Deterministic Rate Resolution — complete
- Phase 17-B: Estimate Pricing Auto-Apply — complete
- Post-merge `develop` CI for Phase 17-B — verified green

## Product outcome
A user must be able to provide a material demand through:
1. image/camera (including handwritten lists),
2. voice, or
3. typed/free text,
and receive a structured ERP-entry draft. For Estimate, the draft must reuse the existing selected Rate List context and Phase 17 deterministic pricing resolver so item/quantity entry can result in automatic pricing without manual rate entry when a valid rate exists.

## Engineering principles
- Core ERP correctness before AI convenience.
- AI output is untrusted candidate data, never accounting authority.
- Deterministic domain services own product identity, pricing and financial mutation.
- Never fabricate an item, rate, customer, vendor or quantity.
- Ambiguity becomes an explicit review state.
- Preserve tenant/organization isolation.
- Use idempotency at mutation boundaries.
- Provider adapters must be replaceable.
- No manual edits by the founder; provide complete implementation changes through the engineering workflow.

## Workstream 18-A — Contracts
Create domain-safe contracts for:
- input source (`image`, `voice`, `text`)
- extraction request/result
- structured document candidate
- candidate line
- confidence
- unresolved/ambiguity reason
- review/confirmation decision
- provider-neutral metadata

Do not leak provider-specific SDK types into domain services.

## Workstream 18-B — Extraction adapters
Define replaceable interfaces for:
- OCR/image extraction
- speech-to-text
- text parsing

Initial adapters may be deterministic/mock adapters if production credentials/providers are not yet configured. Do not invent external provider availability.

## Workstream 18-C — Normalization and entity matching
Normalize item names, brands, dimensions/specifications, quantities and units. Match against existing product master using organization scope. Return zero, one, or multiple candidates. Multiple matches must be unresolved rather than guessed.

## Workstream 18-D — Confidence policy
Implement explicit thresholds/policies for:
- accepted candidate
- review required
- unresolved

Confidence is advisory; business invariants still control mutation.

## Workstream 18-E — Estimate integration
Connect confirmed candidates to the existing Estimate service. Preserve selected `default_rate_list_id` and line-level pricing context. Pass structured product/quantity/brand/rate-list hints into the existing Phase 17 deterministic Pricing Resolver. Do not duplicate pricing algorithms.

Expected flow:
Input → extraction → normalization → product match → candidate review → Estimate line → Phase 17 pricing resolver → priced estimate line.

## Workstream 18-F — Mutation safety
Before authoritative mutation:
- validate organization ownership
- validate product identity
- validate quantity/unit
- resolve price through existing pricing authority
- enforce idempotency/duplicate protection
- record source and resolution metadata where the current schema supports it

## Workstream 18-G — Tests
At minimum cover:
- typed input extraction
- voice transcript parsing
- image/OCR adapter contract
- normalization
- exact product match
- ambiguous product match
- unknown product
- brand and size matching
- selected Rate List propagation
- automatic Phase 17 pricing
- missing rate
- ambiguous rate
- manual correction/override
- duplicate/idempotent submission
- tenant isolation
- malformed/hostile input
- provider failure/fallback behavior

## Workstream 18-H — CI and delivery
Required gates:
1. focused tests
2. full backend tests
3. TypeScript typecheck
4. production build
5. security/audit gate according to repository workflow
6. branch CI green
7. PR to `develop`
8. merge
9. fresh post-merge `develop` CI green on the merge commit
10. final completion report with exact evidence

## Non-goals
- Do not rebuild pricing.
- Do not rebuild Estimate pricing integration.
- Do not implement autonomous accounting posting.
- Do not hard-code a single OCR or voice vendor into domain logic.
- Do not persist raw media without an explicit storage decision.
- Do not skip human review for ambiguous financial data.

## Definition of Done
Phase 18 is not complete until the implementation, tests, typecheck, build, CI, PR merge and post-merge `develop` CI are all verified. A successful branch CI alone is not a final pass.

## Final reporting format
Report:
- implemented workstreams
- changed files/migrations
- tests and results
- typecheck/build/security results
- PR number and merge SHA
- post-merge `develop` CI run and conclusion
- known non-blocking limitations
- final PASS/NOT PASS decision
