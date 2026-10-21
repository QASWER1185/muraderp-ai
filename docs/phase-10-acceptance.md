# Phase 10 Acceptance Gate

Phase 10 is complete only when all gates pass:

1. Identity and organization membership schema exists and is covered by RLS.
2. Explicit role/permission catalog exists and is tested.
3. Backend authorization denies missing permissions with HTTP 403.
4. Existing transactional services remain authoritative; no parallel mutation path is introduced.
5. Legacy ERP data receives an explicit organization-scoping/backfill strategy before tenant RLS is enforced on each domain.
6. Supabase runtime verifies membership and permission functions.
7. Security Advisor findings introduced by Phase 10 are zero.
8. Typecheck, tests, build and audit are green.
9. Regression tests for existing ERP modules remain green.
10. PR is merged into develop and post-merge CI is green.
