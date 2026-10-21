import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migrationName = "20260902090000_p0_non_sales_transaction_convergence.sql";
const migration = readFileSync(
  resolve(root, "supabase/migrations", migrationName),
  "utf8",
);
const compact = migration.replace(/\s+/g, " ").toLowerCase();

const functions = [
  {
    name: "record_purchase",
    operation: "purchase.create",
    permission: "purchases.create",
    legacySignature:
      "bigint,bigint,jsonb,date,text,numeric,numeric,text,text,text,text,text",
  },
  {
    name: "record_customer_payment",
    operation: "customer-payment.create",
    permission: "payments.create",
    legacySignature:
      "bigint,date,numeric,text,text,text,text,jsonb,text,text,text,text",
  },
  {
    name: "record_vendor_payment",
    operation: "vendor-payment.create",
    permission: "payments.create",
    legacySignature:
      "bigint,numeric,text,jsonb,date,text,text,text,text,text",
  },
  {
    name: "record_sales_return",
    operation: "sales-return.create",
    permission: "returns.create",
    legacySignature:
      "text,bigint,bigint,date,text,text,text,jsonb,text,text,text,text",
  },
] as const;

function functionSql(name: string): string {
  const startMatch = new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${name}\\s*\\(`,
    "i",
  ).exec(migration);
  if (!startMatch?.index && startMatch?.index !== 0) {
    throw new Error(`Missing public.${name} in ${migrationName}`);
  }
  const end = migration.indexOf("$$;", startMatch.index);
  if (end < 0) throw new Error(`Unterminated public.${name} in ${migrationName}`);
  return migration.slice(startMatch.index, end + 3).replace(/\s+/g, " ").toLowerCase();
}

function privateFunctionSql(name: string): string {
  const startMatch = new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+private\\.${name}\\s*\\(`,
    "i",
  ).exec(migration);
  if (!startMatch?.index && startMatch?.index !== 0) {
    throw new Error(`Missing private.${name} in ${migrationName}`);
  }
  const end = migration.indexOf("$$;", startMatch.index);
  if (end < 0) throw new Error(`Unterminated private.${name} in ${migrationName}`);
  return migration.slice(startMatch.index, end + 3).replace(/\s+/g, " ").toLowerCase();
}

function alterationsFor(table: string): string {
  return (migration.match(new RegExp(`alter\\s+table\\s+public\\.${table}\\b[\\s\\S]*?;`, "gi")) ?? [])
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function expectScopedContext(sql: string, operation: string, permission: string): void {
  for (const parameter of [
    "p_organization_id uuid",
    "p_branch_id uuid",
    "p_actor_user_id uuid",
    "p_service_principal text",
    "p_operation_scope text",
  ]) {
    expect(sql).toContain(parameter);
  }

  expect(sql).toContain("private.assert_authoritative_non_sales_context");
  expect(sql).toContain(`'${permission}'`);
  expect(sql).toContain("p_service_principal");
  expect(sql).toContain(`'${operation}'`);
}

describe("P0 non-sales authoritative transaction convergence", () => {
  it("is a strictly forward-only migration above the accepted canonical chain", () => {
    expect(migrationName.slice(0, 14) > "20260831061425").toBe(true);
    expect(migration).toContain("P0");
  });

  it("adds explicit ownership and actor context without assigning legacy rows", () => {
    expect(alterationsFor("vendors")).toContain("organization_id uuid");

    for (const table of [
      "purchases",
      "customer_payments",
      "vendor_payments",
      "credit_notes",
      "purchase_idempotency_keys",
      "customer_payment_idempotency_keys",
      "vendor_payment_idempotency_keys",
      "credit_note_idempotency_keys",
    ]) {
      const alterations = alterationsFor(table);
      expect(alterations, `${table} organization scope`).toContain("organization_id uuid");
      expect(alterations, `${table} branch scope`).toContain("branch_id uuid");
      expect(alterations, `${table} actor attribution`).toContain("actor_user_id uuid");
    }

    for (const table of ["vendor_payable_ledger_entries"]) {
      const alterations = alterationsFor(table);
      expect(alterations, `${table} organization scope`).toContain("organization_id uuid");
      expect(alterations, `${table} branch scope`).toContain("branch_id uuid");
    }

    // The approved ownership evidence explicitly forbids default/synthetic
    // assignments and blanket ownership backfills for existing rows.
    expect(migration).not.toMatch(
      /update\s+public\.(?:vendors|customers|products|warehouses|inventory|purchases|customer_payments|vendor_payments|credit_notes|stock_movements)\b[\s\S]*?\bset\b(?:(?!\bwhere\b|;)[\s\S])*\b(?:organization_id|branch_id|actor_user_id)\s*=/i,
    );
    expect(migration).not.toMatch(
      /(?:organization_id|branch_id|actor_user_id)\s+uuid\s+(?:not\s+null\s+)?default\b/i,
    );
    expect(migration).not.toMatch(
      /alter\s+column\s+(?:organization_id|branch_id|actor_user_id)\s+set\s+not\s+null/i,
    );
  });

  it("enforces actor, organization, branch, permission, and principal context in every RPC", () => {
    const authorization = privateFunctionSql("assert_authoritative_non_sales_context");
    expect(authorization).toContain("is_organization_member_for_user");
    expect(authorization).toContain("has_permission_for_user");
    expect(authorization).toContain("has_branch_access_for_user");
    expect(authorization).toContain("p_organization_id is null");
    expect(authorization).toContain("p_branch_id is null");
    expect(authorization).toContain("p_actor_user_id is null");

    for (const entry of functions) {
      expectScopedContext(functionSql(entry.name), entry.operation, entry.permission);
    }
  });

  it("checks organization ownership at the authoritative transaction boundary", () => {
    const purchase = functionSql("record_purchase");
    for (const relation of ["public.vendors", "public.warehouses", "public.products", "public.inventory"]) {
      expect(purchase).toContain(relation);
    }

    const customerPayment = functionSql("record_customer_payment");
    for (const relation of ["public.customers", "public.invoices", "public.customer_payment_allocations"]) {
      expect(customerPayment).toContain(relation);
    }

    const vendorPayment = functionSql("record_vendor_payment");
    for (const relation of ["public.vendors", "public.purchases", "public.vendor_payment_allocations"]) {
      expect(vendorPayment).toContain(relation);
    }

    const salesReturn = functionSql("record_sales_return");
    for (const relation of [
      "public.invoices",
      "public.customers",
      "public.invoice_items",
      "public.products",
      "public.warehouses",
      "public.inventory",
    ]) {
      expect(salesReturn).toContain(relation);
    }

    for (const entry of functions) {
      expect(functionSql(entry.name)).toContain("organization_id");
    }
  });

  it("posts all four flows only to the P0-8 authoritative ledger", () => {
    expect(migration).not.toMatch(/insert\s+into\s+public\.accounting_journal_(?:entries|lines)/i);

    for (const entry of functions) {
      const sql = functionSql(entry.name);
      expect(sql).toContain("public.journal_entries");
      expect(sql).toContain("public.journal_lines");
      expect(sql).toContain("assert_journal_entry_balanced");
      expect(sql).toContain("'posted'");
      expect(sql).toContain("p_organization_id");
      expect(sql).toContain("p_branch_id");
      expect(sql).toContain("p_actor_user_id");
    }

    expect(functionSql("record_purchase")).toContain("public.vendor_payable_ledger_entries");
    expect(functionSql("record_vendor_payment")).toContain("public.vendor_payable_ledger_entries");
    expect(functionSql("record_customer_payment")).toContain("public.customer_ledger_entries");
    expect(functionSql("record_sales_return")).toContain("public.customer_ledger_entries");
  });

  it("keeps the deferred P0-8 balance guard in its trusted owner context", () => {
    expect(compact).toContain(
      "alter function private.enforce_authoritative_journal_balance_at_post() security definer",
    );
    expect(compact).toContain(
      "alter function private.enforce_authoritative_journal_balance_at_post() owner to postgres",
    );
  });

  it("keeps inventory and stock effects inside the scoped purchase and return transactions", () => {
    for (const name of ["record_purchase", "record_sales_return"]) {
      const sql = functionSql(name);
      expect(sql).toContain("public.inventory");
      expect(sql).toContain("public.stock_movements");
      expect(sql).toContain("organization_id");
      expect(sql).toContain("branch_id");
    }
  });

  it("scopes idempotency to organization and preserves replay/mismatch protection", () => {
    for (const entry of functions) {
      const sql = functionSql(entry.name);
      expect(sql).toContain("request_fingerprint");
      expect(sql).toContain("idempotency_key");
      expect(sql).toContain("for update");
      expect(sql).toContain("p0001");
      expect(sql).toContain("organization_id");
    }

    expect(migration).not.toContain("chr(0)");
    const customerPayment = functionSql("record_customer_payment");
    expect(customerPayment).toContain("pg_advisory_xact_lock");
    expect(customerPayment).toContain("hashtextextended");
    expect(customerPayment).toContain("jsonb_build_array");
    expect(customerPayment).toMatch(/order\s+by[\s\S]*?for\s+update/i);
  });

  it("removes service-role access to every legacy unscoped overload", () => {
    expect(compact).toContain(
      "revoke all on function %s from public, anon, authenticated, service_role",
    );
    for (const entry of functions) {
      expect(compact).toContain(
        `'public.${entry.name}(${entry.legacySignature})'`,
      );
    }
  });

  it("exposes only the context-aware overloads to service_role", () => {
    for (const entry of functions) {
      const sql = functionSql(entry.name);
      expect(sql).toContain("security definer");
      expect(sql).toContain("set search_path = ''");
      expect(compact).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${entry.name}\\s*\\(\\s*uuid\\s*,\\s*uuid\\s*,\\s*uuid\\s*,\\s*text\\s*,\\s*text`,
          "i",
        ),
      );
    }
  });
});
