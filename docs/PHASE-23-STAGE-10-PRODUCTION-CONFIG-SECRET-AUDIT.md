# MURADERP-AI — Phase 23 / Stage 10
## Production Configuration / Secret Management Audit

### Scope
Stage 10 hardens the production configuration boundary without introducing a new product feature.

### Locked requirements
- Production must provide the complete ERP configuration set: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `INTERNAL_API_TOKEN`.
- Production Supabase access must use an HTTPS URL.
- The server-only Supabase credential must use the `sb_secret_` format; browser code must never receive it.
- Production placeholder values are rejected at startup.
- `.env` and `.env.local` remain ignored by Git.
- No secret material is committed to the repository or emitted as normal application configuration output.
- Existing authorization, organization isolation, RBAC, idempotency, auditability and AI confirmation boundaries remain unchanged.

### Implementation
`backend/src/config/env.ts` now exposes a testable `parseEnv()` boundary and enforces production-only requirements at startup. The application still fails closed when the environment is invalid.

### Regression coverage
`backend/test/env-config.test.ts` verifies:
1. complete HTTPS production configuration is accepted;
2. partial ERP configuration is rejected;
3. HTTP Supabase URLs are rejected in production;
4. placeholder Supabase secrets are rejected;
5. placeholder internal tokens are rejected.

### Repository evidence
- `backend/.env.example` contains placeholders only.
- `.gitignore` excludes `.env` and `.env.local`.
- CI uses GitHub Actions and does not require committing runtime secrets.

### Acceptance rule
Stage 10 is not PASS on static inspection alone. It requires:
- implementation committed on the Stage 10 feature branch;
- complete backend typecheck/test/build;
- production configuration regression tests;
- security/dependency/secret hygiene gates;
- PR review/CI GREEN;
- merge to `develop`;
- exact merge SHA verification;
- exact post-merge `develop` CI GREEN.
