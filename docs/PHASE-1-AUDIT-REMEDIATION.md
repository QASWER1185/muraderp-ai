# Phase 1 Audit & Remediation

## Scope

Phase 1 established the tested TypeScript/Express API foundation and an initial in-memory Customer CRUD implementation.

## Audit finding

The historical in-memory Customer API remained mounted in the current `develop` application alongside the canonical Supabase-backed ERP Customer API. This created two persistence authorities for the same business entity:

- Canonical: `/api/v1/customers` through the authorized ERP/Supabase service.
- Legacy: `/api/customers` through an in-memory repository.

For the production-grade MuradERP-AI architecture, Customer must have one authoritative persistence path.

## Remediation

The legacy `/api/customers` application mount was removed. The canonical `/api/v1/customers` ERP route remains the authoritative Customer API. The historical controller/service/repository/model files are retained temporarily on this audit branch only until compilation/test verification confirms they are no longer referenced; they will then be deleted in the same remediation change set if safe.

## Verification requirement

This branch must pass backend typecheck, full backend tests, and production build before the Phase 1 audit can be marked FINAL/PASS/CLOSED.
