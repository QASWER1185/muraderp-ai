# MuradERP-AI

Copilot analytics use the configured Gemini native function-calling loop. The
registered read tools are `erp_get_profit_summary`, `erp_get_top_customers`,
`erp_get_top_salesmen`, `erp_get_top_profitable_products`, `erp_get_top_vendors`,
`erp_get_daily_cash_summary`, `erp_get_slow_moving_stock`, and
`erp_get_inventory_summary`. They also have read-only HTTP endpoints at
`POST /api/copilot/analytics/<tool>` (also `/api/v1/ai/copilot/analytics/<tool>`).
Use the normal Copilot browser session or an authorized internal service token,
the `X-Branch-Id` header, and `{ organizationId, input }`; internal callers also
provide their authorized `userId`. Tool input never accepts tenant identifiers.
Permissions and branch access are checked before every report.

Calendar periods use Asia/Karachi. Profit and cash come from posted general
ledger entries; COGS uses account 5000 and cash uses account 1000, excluding bank
balances. Rankings use posted invoices/returns, historical costs and party
ledgers, with currencies kept separate. Warehouse stock is organization scoped.
Missing historical costs are reported, never replaced with zero. The catalog
audit tool `erp_audit_catalog_rates` compares the supplied Dura Max variants and
prices with active ERP rates; corrections use the existing rate-change preview
and explicit confirmation. No report or audit changes business records.
Standalone rate questions use `erp_get_product_sale_rate` to resolve the exact
brand/specification and active sale price in one read without model-guessed IDs.

Run `node scripts/copilot-live-acceptance.mjs --output <local-path.json>` for
read-only production chat transcripts. Credentials are read from environment or
Google Secret Manager and are never written to transcripts. Use `--local-chat`
after a backend build to test the local agent against live Gemini/ERP sources.
Keep transcripts containing business data in a private local output directory.

A reliable, maintainable ERP for building-material, electrical, and sanitary businesses.
The business workflow may take inspiration from QuickBooks, but the implementation and branding are original.

## Verified status

The repository provides a tested backend and database foundation:

- TypeScript and Express API
- canonical versioned API path (`/api/v1`)
- validated environment configuration
- security headers and JSON request limits
- consistent 404 and internal-error responses
- graceful shutdown
- automated API tests
- schema-typed Customer, Vendor, Product, Brand, Warehouse, Inventory, Stock Movement,
  and Purchase APIs
- keyset pagination for list endpoints
- internal bearer-token protection for every database-backed route
- the existing in-memory Customer CRUD remains temporarily available on `/api/customers`

The database-backed API uses a server-only Supabase secret key and calls `record_purchase(...)`
for atomic purchase writes. It does not expose the secret key or internal API token to browser code.
End-user authentication, organization isolation, estimates, invoices, AI, OCR, voice entry,
WhatsApp integration, and offline sync are not verified yet.

## Database foundation

The Supabase schema is versioned in `supabase/migrations/`. The first database migration:

- preserves the existing Customers, Vendors, Products, Warehouses, Inventory, Purchases,
  Purchase Items, and Stock Movements tables
- adds Brands and a product-to-brand relationship
- adds missing foreign-key indexes and timestamp maintenance triggers
- keeps browser-facing `anon` and `authenticated` roles deny-by-default until application
  authentication and organization isolation are implemented
- adds `record_purchase(...)`, which writes the purchase, its lines, stock movements, and
  inventory balance atomically

The transactional smoke test is in `supabase/tests/database_foundation.sql`. It rolls back all
technical fixture rows and does not modify business data.

Never commit a Supabase secret key, service-role key, database password, or access token.

## Database-backed API

Copy `backend/.env.example` to `backend/.env`, then provide values for:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` using a current `sb_secret_...` server key
- `INTERNAL_API_TOKEN` using a random value of at least 32 characters

Database-backed requests require this header:

```text
Authorization: Bearer <INTERNAL_API_TOKEN>
```

Versioned business API routes also accept the optional server-side `X-API-Key` credential
configured as `MURAD_API_KEY`. Set a high-entropy secret in the backend environment; requests
with a valid key still pass through tenant and transaction authorization checks. Browser session
cookies remain supported. The API key is not used by `/api/copilot` or `/api/v1/ai/copilot`.

Available versioned resources:

- `/api/v1/brands`
- `/api/v1/customers`
- `/api/v1/vendors`
- `/api/v1/products`
- `/api/v1/warehouses`
- `/api/v1/inventory`
- `/api/v1/stock-movements`
- `/api/v1/purchases`

Inventory and stock movements are read-only. Purchases can only be created through the atomic
purchase endpoint; independent purchase-item writes and unsafe stock mutations are intentionally
not exposed.

## Requirements

- Node.js 22 or newer
- npm 11 or newer

## Start locally

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000/api/v1/health`.

Expected response:

```json
{
  "status": "ok",
  "service": "muraderp-api",
  "version": "0.1.0",
  "timestamp": "..."
}
```

The canonical Customer endpoint is `http://localhost:3000/api/v1/customers` and requires the
internal bearer token. The former in-memory `/api/customers` path is temporarily retained only for
compatibility.

## Verify before committing

```bash
cd backend
npm run check
```

## Copilot slip estimates

Copilot accepts 1–10 images/PDFs in one message (8 MB combined). JPEG/JPG MIME
aliases and data URLs are normalized before content validation and Gemini requests.
Typed customer/address, brand and discount choices override OCR. A complete slip
produces one Urdu preview, including a new customer when needed, using active
Rate List prices without reading inventory. Brand, size, pressure and class remain
strict constraints; unclear quantities or unreadable lines require correction.
Only the final approved preview is persisted. Costs and accounting posting retain
their existing checks. Browser session storage keeps signed, scoped conversation
context across reloads until expiry; raw attachments and provider keys are not included.

Apply `20261022010000_catalog_heading_resolution.sql` before releasing this flow.
It searches active imported catalog headings for material context while preserving
brand, numeric-size, organization and branch restrictions. Database regression
coverage is in `supabase/tests/depot_v9.sql` (`npm run test:database` in `backend`).

Build the root Dockerfile into a commit-tagged Artifact Registry image, deploy
that image to Cloud Run with the matching `RELEASE_COMMIT`, then explicitly route
traffic to its ready revision. The Dockerfile supports the Cloud Build Docker
builder without BuildKit cache mounts. Vercel proxies both `/api/v1/*` and
`/api/copilot/*`; the root `vercel.json` builds and serves `frontend/dist`.

## Architecture decision

MuradERP starts as a modular monolith. This keeps transactions and deployment simple while the core
accounting and inventory rules are established. Modules should be separated only when verified scale
or operational needs justify it.

Founder: Qaswer Hussain
