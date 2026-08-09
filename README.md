# MuradERP-AI

A reliable, maintainable ERP for building-material, electrical, and sanitary businesses.
The business workflow may take inspiration from QuickBooks, but the implementation and branding are original.

## Verified status

Milestone 1 provides a tested backend foundation in `backend/`:

- TypeScript and Express API
- canonical versioned API path (`/api/v1`)
- validated environment configuration
- security headers and JSON request limits
- consistent 404 and internal-error responses
- graceful shutdown
- automated API tests
- the existing in-memory Customer CRUD remains available while database work is pending

Backend-to-Supabase persistence, estimates, invoices, AI, OCR, voice entry, WhatsApp integration,
and offline sync are not verified in the current repository yet.

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

The canonical Customer endpoint is `http://localhost:3000/api/v1/customers`.
The former `/api/customers` path is temporarily retained for compatibility.

## Verify before committing

```bash
cd backend
npm run check
```

## Architecture decision

MuradERP starts as a modular monolith. This keeps transactions and deployment simple while the core
accounting and inventory rules are established. Modules should be separated only when verified scale
or operational needs justify it.

Founder: Qaswer Hussain
