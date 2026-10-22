# Approved Dura Max catalog price changes

Applied to the live ERP on 22 October 2026 after explicit merchant approval of
the prepared three-item preview. The existing Copilot confirmation workflow
returned HTTP 200, `executed: true`, `verified: true`, and action status
`EXECUTED` at `2026-10-22T12:22:29.470Z`.

- Dura Max Gate Valve With Plastic Cap 32 mm, product 426: PKR 2,117 → PKR 1,889 per pcs; rate list 6, active version 9.
- Dura Max Gate Valve With Plastic Cap 25 mm, product 425: PKR 1,681 → PKR 1,492 per pcs; rate list 6, active version 9.
- Dura Max Solvent 500 g, product 314: PKR 1,399 → PKR 1,104 per pcs; rate list 5, active version 8.

These are catalog list prices. Customer discounts remain subject to the
existing historical-discount and merchant cost-floor rules.

Confirmation used draft `0f2871f4-ef77-4174-b177-5091f257cd8b` and produced ERP
operation `4f2a8364-9344-4de3-866c-4a189b88444c` with status `UPDATED` and
`itemCount: 3`. Original prices and versions matched the approved preview
before execution.

Independent database reads verified all 205 active rows across the two affected
catalogs after execution. All three approved prices matched, no catalog rows
were added or removed, and all unrelated prices were unchanged. No application
code or database schema changes were required; the live data update takes effect
without rebuilding the deployed application. Credentials and private database
snapshots are excluded from this record.
