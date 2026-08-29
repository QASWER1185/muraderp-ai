import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDirectInvoice } from "../src/types/invoice.types.js";
import { assertSalesTransactionRequest, type SalesTransactionRequest } from "../src/types/sales-transaction.types.js";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(resolve(root, "supabase/migrations/20260829173824_p0_8_authoritative_accounting_posting_foundation.sql"), "utf8");

function request(overrides: Partial<SalesTransactionRequest> = {}): SalesTransactionRequest {
  return {
    organization_id: "11111111-1111-4111-8111-111111111111",
    branch_id: null,
    actor_user_id: "22222222-2222-4222-8222-222222222222",
    invoice: buildDirectInvoice(
      { invoice_number: "INV-P0-8-001", customer_id: 1, issue_date: "2026-08-29", currency_code: "PKR" },
      [],
      1000,
      0,
      1000,
      100,
    ),
    warehouse_id: 1,
    lines: [{ line_number: 1, product_id: 1, quantity: 2, unit: "piece", unit_price: 500, line_total: 1000, unit_cost: 300, cogs_total: 600 }],
    idempotency_key: "p0-8-idem-001",
    ...overrides,
  };
}

describe("P0-8 authoritative accounting posting foundation", () => {
  it("keeps the authoritative GL on accounts/journal_entries/journal_lines only", () => {
    expect(migration).toContain("public.accounts");
    expect(migration).toContain("public.journal_entries");
    expect(migration).toContain("public.journal_lines");
    expect(migration).not.toMatch(/insert\s+into\s+public\.accounting_journal_entries/i);
    expect(migration).not.toMatch(/insert\s+into\s+public\.accounting_journal_lines/i);
  });

  it("enforces organization-aware source and idempotency uniqueness", () => {
    expect(migration).toContain("journal_entries_p0_8_source_key");
    expect(migration).toContain("organization_id, source_type, source_record_id, posting_kind");
    expect(migration).toContain("sales_transaction_idempotency_p0_8_scope_key");
    expect(migration).toContain("organization_id, principal_id, operation_scope, idempotency_key");
    expect(migration).toContain("drop index if exists public.sales_transaction_idempotency_unique");
    expect(migration).toContain("request_fingerprint");
  });

  it("scopes invoice-number uniqueness to the organization", () => {
    expect(migration).toContain("drop constraint if exists invoices_invoice_number_key");
    expect(migration).toContain("invoices_p0_8_organization_invoice_number_key");
    expect(migration).toContain("organization_id, invoice_number");
  });

  it("requires P0-5 permissions and optional explicit branch access", () => {
    expect(migration).toContain("is_organization_member_for_user");
    expect(migration).toContain("has_permission_for_user(p_actor_user_id, p_organization_id, 'sales.create')");
    expect(migration).toContain("has_permission_for_user(p_actor_user_id, p_organization_id, 'accounting.post')");
    expect(migration).toContain("has_branch_access_for_user");
  });

  it("makes POSTED journals balanced, positive, and immutable", () => {
    expect(migration).toContain("posted journal requires at least two lines");
    expect(migration).toContain("posted journal total debit must be greater than zero");
    expect(migration).toContain("posted journal total debits must equal total credits");
    expect(migration).toContain("journal status transition must be DRAFT to POSTED");
    expect(migration).toContain("authoritative journal lines are immutable after insert");
    expect(migration).toContain("deferrable initially deferred");
  });

  it("keeps grand_total product-only and posts rent exactly once through AR and Rent Payable", () => {
    expect(migration).toContain("v_grand_total <> v_subtotal - v_discount");
    expect(migration).not.toContain("v_grand_total <> v_subtotal - v_discount + v_rent");
    expect(migration).toContain("v_ar_account, v_grand_total + v_rent, 0, 'Customer receivable'");
    expect(migration).toContain("v_rent_payable_account, 0, v_rent, 'Pass-through rent payable'");
    expect(migration).not.toContain("RENT_RECEIVABLE");
  });

  it("does not infer a costing method", () => {
    expect(migration).toContain("explicit posted unit_cost and cogs_total are required; P0-8 does not invent a costing method");
    expect(migration).not.toContain("purchase_price");
  });

  it("disables legacy sales posting and void entry points for service/browser roles", () => {
    expect(migration).toContain("revoke all on function public.post_invoice_atomic(jsonb,jsonb,bigint,text,text)");
    expect(migration).toContain("record_sales_transaction");
    expect(migration).toContain("void_invoice_atomic(bigint,text)");
    expect(migration).toContain("from public, anon, authenticated, service_role");
  });

  it("validates the accepted rent arithmetic and explicit COGS contract", () => {
    expect(() => assertSalesTransactionRequest(request())).not.toThrow();
    const rentFoldedIntoGrandTotal = request({ invoice: { ...request().invoice, grand_total: 1100 } });
    expect(() => assertSalesTransactionRequest(rentFoldedIntoGrandTotal)).toThrow("grand_total must equal subtotal minus discount");
    const missingCost = request({ lines: [{ ...request().lines[0]!, unit_cost: null, cogs_total: null }] });
    expect(() => assertSalesTransactionRequest(missingCost)).toThrow("costing is not inferred");
  });
});
