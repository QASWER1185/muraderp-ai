import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import type { Database } from "../types/database.types.js";
import type { InvoiceTransactionResult } from "../types/invoice.types.js";
import type { SalesTransactionPort, SalesTransactionRequest } from "../types/sales-transaction.types.js";
import { normalizeServicePrincipalId } from "../security/service-principal.js";

interface RpcResponse<T> { data: T | null; error: PostgrestError | null }
type RpcInvoker = <T>(functionName: string, args: Record<string, unknown>) => Promise<RpcResponse<T>>;
interface AtomicInvoiceRpcResult { invoice_id: number; replayed: boolean; revenue: number; cogs: number; rent: number; profit: number }
function rpcError(error: PostgrestError): Error { return new Error(`Invoice transaction failed: ${error.message}`); }

export class SupabaseSalesTransactionAdapter implements SalesTransactionPort {
  constructor(clientFactory: () => SupabaseClient<Database>, principalId: string);
  constructor(
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient,
    private readonly principalId?: string,
  ) {}

  async execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult> {
    const principalId = normalizeServicePrincipalId(this.principalId);
    if (!principalId) {
      throw new Error("Explicit sales transaction service principal is required");
    }
    const client = this.clientFactory();
    const rpc = client.rpc as unknown as RpcInvoker;
    const { data, error } = await rpc<AtomicInvoiceRpcResult>("post_invoice_atomic", {
      p_invoice: {
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
      },
      p_lines: request.lines,
      p_warehouse_id: request.warehouse_id,
      p_principal_id: principalId,
      p_idempotency_key: request.idempotency_key,
    });
    if (error) throw rpcError(error);
    if (!data) throw new Error("Invoice transaction returned no result");
    return {
      invoice: { ...request.invoice, id: data.invoice_id, status: "POSTED" },
      inventory_decreased: true,
      customer_receivable_updated: true,
      revenue_recorded: true,
      cogs_recorded: true,
      profit_loss_recorded: true,
      pass_through_rent_recorded: data.rent > 0,
    };
  }
}
