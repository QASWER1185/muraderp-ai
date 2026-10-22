# MuradERP-AI

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

Cloud Run images use `cloudbuild.cloudrun.yaml` to enable the Dockerfile's BuildKit
cache mounts. Set `_IMAGE` to a commit-tagged Artifact Registry image and `_COMMIT`
to the deployed Git SHA when submitting the build, then deploy that image and
route traffic to its ready revision. Vercel proxies both `/api/v1/*` and
`/api/copilot/*`; its project root directory is `frontend`.

## Architecture decision

MuradERP starts as a modular monolith. This keeps transactions and deployment simple while the core
accounting and inventory rules are established. Modules should be separated only when verified scale
or operational needs justify it.

Founder: Qaswer Hussain
