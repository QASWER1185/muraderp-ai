import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";
import type { Database } from "../types/database.types.js";
import type { InvoiceTransactionResult } from "../types/invoice.types.js";
import type { SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";

type RpcClient = SupabaseClient<Database> & { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };
interface AtomicInvoiceRpcResult { invoice_id: number; journal_entry_id: string; replayed: boolean; revenue: number; cogs: number; rent: number; profit: number }
const OPERATION_SCOPE = "sales.invoice.post";

function fingerprint(request: SalesTransactionRequest): string {
  const canonical = JSON.stringify({
    organization_id: request.organization_id,
    branch_id: request.branch_id,
    actor_user_id: request.actor_user_id,
    operation_scope: OPERATION_SCOPE,
    invoice: request.invoice,
    warehouse_id: request.warehouse_id,
    lines: request.lines,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function mapDatabaseError(error: { code?: string; message?: string }): ApiError {
  switch (error.code) {
    case "42501": return new ApiError(403, "AUTHORIZATION_DENIED", error.message ?? "The sales transaction is not authorized for this organization");
    case "P0001": return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for a different sales request");
    case "P0004": return new ApiError(409, "INSUFFICIENT_STOCK", "There is not enough stock to complete this invoice");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", error.message ?? "The invoice, idempotency scope, or authoritative posting already exists");
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", error.message ?? "A required related record is missing or invalid");
    case "23514":
    case "22023":
    case "22P02": return new ApiError(400, "BUSINESS_RULE_VIOLATION", error.message ?? "The sales transaction violates a business rule");
    default: return new ApiError(502, "SALES_TRANSACTION_FAILED", "The sales transaction could not be completed");
  }
}

function invoicePayload(request: SalesTransactionRequest): Record<string, unknown> {
  return {
    invoice_number: request.invoice.definition.invoice_number,
    customer_id: request.invoice.definition.customer_id,
    salesperson_id: request.invoice.definition.salesperson_id ?? null,
    source_estimate_id: request.invoice.source_estimate_id,
    source_type: request.invoice.source_type,
    issue_date: request.invoice.definition.issue_date,
    currency_code: request.invoice.definition.currency_code,
    subtotal: request.invoice.subtotal,
    discount_total: request.invoice.discount_total,
    grand_total: request.invoice.grand_total,
    pass_through_rent: request.invoice.pass_through_rent,
    notes: request.invoice.definition.notes ?? null,
  };
}

export class SupabaseSalesTransactionRepository implements SalesTransactionPort {
  constructor(
    private readonly principalId: string,
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient,
  ) {}

  async execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult> {
    const principalId = normalizeServicePrincipalId(this.principalId);
    if (!principalId) throw new ApiError(500, "ERP_NOT_CONFIGURED", "An explicit named sales service principal is required");

    const client = this.clientFactory() as RpcClient;
    const { data, error } = await client.rpc("post_invoice_atomic", {
      p_organization_id: request.organization_id,
      p_branch_id: request.branch_id,
      p_actor_user_id: request.actor_user_id,
      p_service_principal: principalId,
      p_operation_scope: OPERATION_SCOPE,
      p_idempotency_key: request.idempotency_key,
      p_request_fingerprint: fingerprint(request),
      p_invoice: invoicePayload(request),
      p_lines: request.lines,
      p_warehouse_id: request.warehouse_id,
    });

    if (error) throw mapDatabaseError(error);
    if (!data || typeof data !== "object") throw new ApiError(502, "SALES_TRANSACTION_FAILED", "The database did not return an authoritative invoice result");
    const result = data as Partial<AtomicInvoiceRpcResult>;
    const invoiceId = Number(result.invoice_id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0 || typeof result.journal_entry_id !== "string" || !result.journal_entry_id) {
      throw new ApiError(502, "SALES_TRANSACTION_FAILED", "The database did not return a valid invoice and journal identity");
    }

    const cogs = Number(result.cogs ?? 0);
    const revenue = Number(result.revenue ?? 0);
    const rent = Number(result.rent ?? 0);
    return {
      invoice: { ...request.invoice, id: invoiceId, status: "POSTED" },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: revenue > 0,
      cogs_recorded: cogs > 0,
      profit_loss_recorded: revenue > 0 || cogs > 0,
      pass_through_rent_recorded: rent > 0,
    };
  }
}
