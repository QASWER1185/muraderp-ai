# Partial catalog ingestion

Catalog extraction prepares all validated priced rows even when the source has
blank prices, dash cells, unreadable rows, or incomplete pages. A partial result
keeps `complete: false`; the preview shows omission warnings and still requires
the existing tenant-scoped user confirmation. Missing prices never become zero.
Explicit printed zero remains a valid numeric observation.

PDF catalog pages are rasterized locally and sent to the vision provider one
page per request. Later pages receive the catalog heading as context. A page
with no recoverable extraction adds an omission warning while readable pages
continue. Provider authentication, quota, and network errors remain errors.

Catalog-only output recovery accepts closed JSON item records and discards an
unfinished tail. It never finishes a partial price, name, or item object. Gemini
uses JSON text for explicit catalogs so completed rows remain available when a
response reaches its token limit. Other document extraction, speech, and ERP
tool execution retain their existing validation. Conflicting duplicate rates
are omitted with warnings; conflicting standard discounts are not applied.

Apply `20261021100000_copilot_partial_catalog_import.sql` before deploying this
backend. It removes the database's whole-document completeness requirement while
preserving per-row validation, tenant isolation, idempotency, permissions and
atomic publication. Historical migrations are unchanged. The database receives
only the rows shown in the approved preview.

Verification covers catalog recovery in the Gemini, Responses, Groq and Anthropic
adapters; per-page extraction and continuation; Urdu confirmation; and actual
PostgreSQL persistence of partial catalogs. The two-page Dura Max U-PVC price
list dated 29 September 2026 contains 85 priced variants and three dash cells.
The fixture in `backend/src/ai-copilot/catalog.test-fixtures.ts` records those rows.
A live Gemini extraction of the original 1,534,607-byte PDF returned 85 items;
all extracted prices matched the checked source. No live ERP import was performed
for that verification.
