# Missing capabilities release — 10 November 2026

The live frontend and backend contained working changes absent from this GitHub checkout. The frontend assets were preserved from the live deployment. The backend release uses `Dockerfile.capabilities`, pinned to the exact original deployed image, and overlays only the new capability router, its three supporting routers, the application mount, and the optional vendor-address schema field. Existing estimate, invoice creation, pricing, rendering, Copilot, and accounting implementations remain in the pinned image.

Use `cloudbuild.capabilities.yaml` for this release. The original repository-root Dockerfile rebuilds the incomplete checkout and does not reproduce the live backend. Reconcile the missing production TypeScript source before returning to that build path. Do not replace `runtime-addon/app.js` with the checkout's compiled app: doing so removes production-only routes. The four new router modules can be regenerated from `backend/dist/routes` after `npm run build --prefix backend`; the preserved application and vendor files contain intentionally narrow edits to their deployed counterparts.

Deploy a candidate with no traffic, verify both estimate snapshots through its tagged URL, then explicitly route traffic to that revision. This service has pinned revision traffic: a successful deployment alone does not move production traffic.

Five additive migrations were applied transactionally and recorded in migration history. No original financial figures, rate lists, discounts, or estimate lines were updated.

## Verification

- Backend source suite: 1,213 tests passed. Database suite: 10 regression suites passed, including stock adjustment and invoice reversal.
- Targeted frontend tests passed, including filtering/sorting/CSV for all seven requested registers. Original list/card renderers are reused; stock movements have their own filter/export controls.
- Full frontend testing identified a pre-existing dashboard wording assertion mismatch; the live business identity was preserved. Browser automation timed out, so no visual browser QA is claimed.
- Live stock cycle: product 17, warehouse 15, balance 1 → 2 → 1, adjustment event IDs 1 and 2.
- Two isolated Rate List versions were published through the canonical API; the previous version became ARCHIVED, the new version resolved its price, and the temporary fixtures were removed.
- Vendor address creation/read and deletion of an unlinked temporary vendor passed.
- Settings API read passed. Settings tabs persist configuration; existing document-number generation and posted calculations are not changed by saving configuration.
- EST-1069 and EST-1070 full API snapshots, including all lines, discounts and totals, matched their captured baselines exactly.
- IDs of every original record in all eleven checked registers remained unchanged.

## Protected cleanup exception

Customer 25, `TEST CUSTOMER - DELETE LATER`, is linked to paid invoice `INV-TEST-20261024-02` and cancelled estimate `EST-TEST-20261024-01`. DELETE correctly returns 409. It was retained to satisfy the required deletion guards. No invoice with the exact number `TEST INVOICE - DELETE LATER` exists. The other paid/posted test-labelled invoices were retained.

The first repository-built backend candidate lacked live estimate-detail routes. Production traffic was reverted immediately; the replacement built on the original image passed both exact snapshot checks before activation. The additive schema changes required no rollback.
