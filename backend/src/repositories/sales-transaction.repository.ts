import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";
import type { InvoiceDocument, InvoiceTransactionResult } from "../types/invoice.types.js";
import type { SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";

type RpcClient = SupabaseClient<Database> & { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> };

function fingerprint(request: SalesTransactionRequest): string {
  const canonical = JSON.stringify({ invoice: request.invoice, warehouse_id: request.warehouse_id, lines: request.lines });
  return createHash("sha256").update(canonical).digest("hex");
}

function mapDatabaseError(error: { code?: string; message?: string }): ApiError {
  switch (error.code) {
    case "P0001": return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for a different sales request");
    case "P0004": return new ApiError(409, "INSUFFICIENT_STOCK", "There is not enough stock to complete this invoice");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", "The invoice number already exists");
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", "A related record prevents this sales transaction");
    case "22023": return new ApiError(400, "BUSINESS_RULE_VIOLATION", error.message ?? "The sales transaction violates a business rule");
    default: return new ApiError(502, "SALES_TRANSACTION_FAILED", "The sales transaction could not be completed");
  }
}

export class SupabaseSalesTransactionRepository implements SalesTransactionPort {
  constructor(
    private readonly principalId: string,
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient,
  ) {}

  async execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult> {
    const client = this.clientFactory() as RpcClient;
    const { data, error } = await client.rpc("record_sales_transaction", {
      p_principal_id: this.principalId,
      p_idempotency_key: request.idempotency_key,
      p_request_fingerprint: fingerprint(request),
      p_invoice_number: request.invoice.definition.invoice_number,
      p_customer_id: request.invoice.definition.customer_id,
      p_source_estimate_id: request.invoice.source_estimate_id,
      p_source_type: request.invoice.source_type,
      p_issue_date: request.invoice.definition.issue_date,
      p_currency_code: request.invoice.definition.currency_code,
      p_subtotal: request.invoice.subtotal,
      p_discount_total: request.invoice.discount_total,
      p_grand_total: request.invoice.grand_total,
      p_pass_through_rent: request.invoice.pass_through_rent,
      p_notes: request.invoice.definition.notes ?? null,
      p_warehouse_id: request.warehouse_id,
      p_items: request.lines,
    });

    if (error) throw mapDatabaseError(error);
    const invoiceId = Number(data);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) throw new ApiError(502, "SALES_TRANSACTION_FAILED", "The database did not return a valid invoice id");

    return {
      invoice: { ...request.invoice, id: invoiceId, status: "POSTED" },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: true,
      cogs_recorded: request.lines.length > 0,
      profit_loss_recorded: true,
      pass_through_rent_recorded: request.invoice.pass_through_rent > 0,
    };
  }
}
