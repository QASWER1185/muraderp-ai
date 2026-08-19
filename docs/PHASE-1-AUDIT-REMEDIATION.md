# Phase 1 Audit & Remediation

## Scope

Phase 1 established the tested TypeScript/Express API foundation and an initial in-memory Customer CRUD implementation.

## Audit finding

The historical in-memory Customer API remained mounted in the current `develop` application alongside the canonical Supabase-backed ERP Customer API. This created two persistence authorities for the same business entity:

- Canonical: `/api/v1/customers` through the authorized ERP/Supabase service.
- Legacy: `/api/customers` through an in-memory repository.

For the production-grade MuradERP-AI architecture, Customer must have one authoritative persistence path.

## Remediation

The legacy `/api/customers` route and its obsolete in-memory controller/service/repository/model were removed from the application boundary. The canonical `/api/v1/customers` ERP route remains the authoritative Customer API.

## Verification requirement

This branch must pass backend typecheck, full backend tests, and production build before the Phase 1 audit can be marked FINAL/PASS/CLOSED.
