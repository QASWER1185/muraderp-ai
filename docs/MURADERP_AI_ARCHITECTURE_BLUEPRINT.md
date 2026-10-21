# MuradERP-AI — Enterprise Architecture Blueprint

## 1. Architectural objective
MuradERP-AI is a QuickBooks-inspired, original, AI-native ERP for building-material, sanitary, electrical, cement, bricks and related businesses. QuickBooks is a workflow benchmark, not a source-code, branding or visual-copy target.

The architecture must support international-quality reliability, auditability, security, scalability and mobile-first usability without unnecessary infrastructure complexity.

## 2. Layered architecture

```text
Web / Mobile / Future Offline Client
            |
        API / BFF
            |
  Application Services / Use Cases
            |
 Domain Rules / Pricing / Documents / Accounting
            |
 Repositories / Transaction Boundaries
            |
 Supabase PostgreSQL + RLS
```

AI sits beside the application layer as a controlled intelligence boundary:

```text
Camera / OCR / Voice / AI Assistant
              |
        Extraction / Intent
              |
      Confidence + Validation
              |
      Human confirmation when needed
              |
       Application Service
              |
       Transaction boundary
              |
           Database
```

AI never becomes direct database authority.

## 3. Core business domains

- Identity / organization / roles
- Customers / CRM / follow-ups
- Vendors
- Products / categories / brands / units
- Rate Lists / versions / price resolution
- Purchasing / purchase returns
- Inventory / warehouses / stock movements / COGS
- Sales: estimates, quotations, invoices, payments, returns
- Finance: customer/vendor ledgers, cash, bank, expenses, profit
- Reporting / analytics
- Documents / PDF / print / WhatsApp
- AI: OCR, camera, voice, matching, assistant, business intelligence

## 4. Commercial document lifecycle

```text
Estimate (DRAFT)
   -> READY
   -> Quotation (DRAFT)
   -> SENT
   -> ACCEPTED
   -> Invoice
   -> Payment
   -> Ledger / Accounting
```

Conversion creates a new document identity and preserves source-document provenance. Original documents are never silently mutated into another document type.

## 5. Estimate rules

Customer-facing estimate follows the approved local business order:

`No. -> Item -> Qty -> Rate -> Total`

Summary:

`Total -> Discount -> Grand Total -> Rent -> Net Payable`

Pass-through rent is customer-payable but is not business revenue or product profit. It must remain separately classified.

Estimated cost and expected profit/loss are intelligence fields. Actual accounting profit is authoritative only after the relevant accounting/inventory transaction exists.

## 6. Pricing architecture

```text
Product Identity
   -> Rate List
   -> Rate List Version
   -> Rate List Item
   -> Price Resolution
   -> Commercial Document
```

Pricing must be deterministic and auditable. Missing or ambiguous rates do not silently fall back to arbitrary values.

## 7. AI safety boundary

AI may:
- read
- extract
- classify
- match
- suggest
- explain
- draft

AI may not silently:
- change stock
- change balances
- post accounting entries
- alter historical documents
- publish pricing

All mutations pass through validated application services and controlled transactions.

## 8. Multi-organization readiness

Organization/company boundaries must be represented at the architecture level even where the first deployment uses one business. Authorization and row-level isolation are defense-in-depth requirements.

## 9. Auditability

Business mutations should retain:
- actor/source
- source document or AI request where applicable
- before/after provenance when required
- timestamps
- resulting document identity

Historical integrity takes priority over destructive convenience.

## 10. API and application principles

- Thin controllers/routes
- Business rules in services/domain layer
- Database access in repositories
- Typed contracts
- Idempotency for externally retried financial mutations
- Transaction boundaries around atomic business operations
- Explicit error types and validation
- No frontend direct authority over business database state

## 11. UI/product principles

QuickBooks-inspired usability:
- fast data entry
- searchable customers/products
- Quick Add
- clear document status
- predictable totals
- print/PDF/WhatsApp
- responsive desktop/mobile layouts

MuradERP-AI differentiation:
- camera/OCR
- voice entry
- AI product/rate matching
- profit intelligence
- smart follow-ups
- AI business assistant
- controlled one-click transformations

## 12. Development gate

A domain is not considered complete because its screen exists. Completion requires:

1. Domain contract
2. Application service
3. Repository/persistence
4. Database constraints
5. Validation
6. Automated tests
7. Audit/provenance considerations
8. API integration
9. UI integration
10. Runtime verification

## 13. Current implementation direction

The active implementation is completing Pricing -> Estimate -> Quotation -> Invoice foundations before building the AI extraction layer on top of stable business services.

This order prevents AI features from becoming an uncontrolled substitute for ERP business rules.
