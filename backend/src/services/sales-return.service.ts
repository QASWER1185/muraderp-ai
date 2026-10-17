import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { AuthoritativeTransactionContext } from "../types/authoritative-transaction.types.js";
import type { Database, Json } from "../types/database.types.js";

export interface SalesReturnItemInput {
  invoice_item_id: number;
  warehouse_id: number;
  quantity: number;
}

export interface SalesReturnInput {
  credit_note_number: string;
  invoice_id: number;
  customer_id: number;
  credit_date: string;
  currency_code: string;
  reason: string;
  notes?: string | undefined;
  items: SalesReturnItemInput[];
}

export type SalesReturnContext = AuthoritativeTransactionContext<"sales-return.create">;

export interface SalesReturnService {
  recordSalesReturn(input: SalesReturnInput, context: SalesReturnContext): Promise<Json>;
}

function mapDatabaseError(error: { code?: string; message?: string }): ApiError {
  switch (error.code) {
    case "P0001": return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was reused for a different sales return request");
    case "P0002": return new ApiError(409, "RETURN_QUANTITY_EXCEEDED", "Return quantity exceeds the remaining invoice quantity");
    case "P0003": return new ApiError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "The Idempotency-Key is currently being processed; retry shortly");
    case "22023": return new ApiError(409, "BUSINESS_RULE_VIOLATION", error.message ?? "The sales return violates a business rule");
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", error.message ?? "A related invoice, customer, item, product, or warehouse was not found");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", "The credit note number or allocation already exists");
    case "42501": return new ApiError(403, "AUTHORIZATION_DENIED", error.message ?? "The sales return is not authorized for this organization or branch");
    default: return new ApiError(502, "DATABASE_OPERATION_FAILED", "Sales return could not be completed");
  }
}

export class SupabaseSalesReturnService implements SalesReturnService {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient) {}

  async recordSalesReturn(input: SalesReturnInput, context: SalesReturnContext): Promise<Json> {
    const params = {
      p_credit_note_number: input.credit_note_number,
      p_invoice_id: input.invoice_id,
      p_customer_id: input.customer_id,
      p_credit_date: input.credit_date,
      p_currency_code: input.currency_code,
      p_reason: input.reason,
      p_notes: input.notes ?? null,
      p_items: input.items as unknown as Json,
      p_organization_id: context.organizationId,
      p_branch_id: context.branchId,
      p_actor_user_id: context.actorUserId,
      p_service_principal: context.servicePrincipalId,
      p_operation_scope: context.operation,
      p_idempotency_key: context.idempotencyKey,
      p_request_fingerprint: context.requestFingerprint,
    };

    const { data, error } = await this.clientFactory().rpc(
      "record_sales_return" as never,
      params as never,
    );
    if (error) throw mapDatabaseError(error);
    if (!data || typeof data !== "object") {
      throw new ApiError(502, "INVALID_DATABASE_RESPONSE", "Sales return returned an invalid database response");
    }
    return data as Json;
  }
}
