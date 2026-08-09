# MuradERP-AI Product Vision

## Purpose

MuradERP-AI is an original, AI-first ERP for building-material, electrical, and sanitary
businesses. Its workflows may be informed by products such as QuickBooks, but the product,
architecture, branding, and implementation must remain original and should improve on those
workflows for the target businesses.

This document defines product direction. It does not claim that every listed capability is
implemented. The README, automated tests, GitHub pull requests, and Supabase migration history
are the sources for verified implementation status.

## Product principles

- Make complex accounting, sales, purchasing, and inventory work simple for a non-technical owner.
- Keep financial and stock changes atomic, auditable, and reversible where business rules allow.
- Use AI to assist and accelerate work, never to silently post uncertain financial transactions.
- Require human confirmation when OCR, matching, pricing, tax, quantity, or party confidence is low.
- Protect company and customer data with server-side secrets, least privilege, and organization
  isolation before enabling browser access.
- Build a modular monolith first; split services only when verified scale or operational needs
  justify the additional complexity.

## AI-native workflows

MuradERP-AI should support:

- creating customer estimates and invoices by voice;
- capturing an estimate, invoice, bill, stock document, or rate list with a camera or uploaded image;
- extracting parties, items, quantities, units, prices, discounts, tax, dates, and references with OCR;
- matching extracted items to the product catalog and presenting uncertain matches for confirmation;
- creating a customer estimate or invoice from confirmed extracted data;
- creating a vendor bill and its related inventory movements from confirmed extracted data;
- preserving the original image, extraction result, corrections, approvals, and posting audit trail;
- providing clear AI explanations and confidence indicators instead of hiding uncertainty.

## Products, brands, suppliers, and rate lists

- Brands and supplier/company rate lists are dynamic business data, not hard-coded values.
- A supplier's or company's rate list can be imported from images or documents, reviewed, and
  versioned with its effective date and source.
- Estimates may contain items from multiple brands or suppliers.
- A user can duplicate or convert an estimate to another brand, supplier, or company rate list in
  one action while keeping the same requested items and preserving the original estimate.
- The conversion must show matched items, missing items, substitutions, price differences, margins,
  and any uncertain mappings before the user confirms the new estimate.

## Core ERP scope

The long-term product includes customers, vendors, products, brands, warehouses, inventory,
purchases, sales, estimates, invoices, returns, expenses, payments, receivables, payables,
accounting, tax, reporting, audit logs, permissions, attachments, and supported integrations.
Inventory and accounting consequences must be produced by authoritative business transactions,
not by unrelated direct table writes.

## Delivery responsibilities and sources of truth

- The product owner defines business intent and approves material production or merge actions.
- The Principal Software Engineer/Architect owns analysis, architecture, implementation, tests,
  security, documentation, and clear copy-paste-ready handoff instructions.
- GitHub is the source of truth for versioned code and documentation.
- Supabase migrations and verified database history are the source of truth for database structure.
- Work advances module by module only after the current foundation is tested and its actual status is
  documented without guesses about IDs, deployments, or completion.
