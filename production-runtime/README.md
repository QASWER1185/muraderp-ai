# Deployed backend snapshot

`backend/runtime` contains every executable JavaScript module recovered from the active production image, plus the verified capability overlay. `backend/package.json` and its lockfile are the matching deployed dependencies. This preserves production-only controllers and services whose original TypeScript was missing from the checkout.

Original image: `sha256:fac23430301c99b5bd55faef4a1f4bdfed7f82da85f743d3f78f763c1c071257`.
Verified additive release: `8adfd9d`; frontend release: `478aa9f`.

Do not replace this runtime with a wholesale compilation of the incomplete TypeScript tree. Regenerate only the additive routes, preserve the baseline application mount and vendor schema edits, and test the exact estimate snapshots before directing traffic to a candidate.
