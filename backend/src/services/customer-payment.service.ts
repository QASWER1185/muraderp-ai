import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { AuthoritativeTransactionContext } from "../types/authoritative-transaction.types.js";
import type { Database, Json } from "../types/database.types.js";

export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER";

export interface CustomerPaymentAllocationInput { invoice_id: number; amount: number }
export interface CustomerPaymentInput {
  customer_id: number;
  payment_date: string;
  amount: number;
  currency_code: string;
  payment_method: PaymentMethod;
  reference_number?: string | undefined;
  notes?: string | undefined;
  allocations: CustomerPaymentAllocationInput[];
}
export type CustomerPaymentIdempotencyContext =
  AuthoritativeTransactionContext<"customer-payment.create">;
export interface CustomerPayment {
  id: number;
  customer_id: number;
  payment_date: string;
  amount: number;
  currency_code: string;
  payment_method: PaymentMethod;
  reference_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export interface CustomerPaymentAllocation { id: number; payment_id: number; invoice_id: number; amount: number; created_at: string }
export interface CustomerPaymentResult { payment: CustomerPayment; allocations: CustomerPaymentAllocation[] }
export interface CustomerPaymentService {
  recordPayment(input: CustomerPaymentInput, idempotency: CustomerPaymentIdempotencyContext): Promise<CustomerPaymentResult>;
}

function databaseError(error: { code?: string; message?: string }, operation: string): ApiError {
  switch (error.code) {
    case "P0001": return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for a different payment request");
    case "P0002": return new ApiError(409, "OVERPAYMENT", "Payment allocation exceeds invoice outstanding balance");
    case "P0003": return new ApiError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "The Idempotency-Key is currently being processed; retry shortly");
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", "A related customer or invoice was not found");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", "A payment allocation already exists");
    case "22023": return new ApiError(400, "BUSINESS_RULE_VIOLATION", error.message ?? "The payment violates a business rule");
    case "42501": return new ApiError(403, "AUTHORIZATION_DENIED", error.message ?? "The customer payment is not authorized for this organization or branch");
    default: return new ApiError(502, "DATABASE_OPERATION_FAILED", `${operation} could not be completed`);
  }
}

export class SupabaseCustomerPaymentService implements CustomerPaymentService {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient) {}

  async recordPayment(input: CustomerPaymentInput, idempotency: CustomerPaymentIdempotencyContext): Promise<CustomerPaymentResult> {
    const allocations: Json = input.allocations.map((allocation) => ({
      invoice_id: allocation.invoice_id,
      amount: allocation.amount,
    }));

    const { data, error } = await this.clientFactory().rpc("record_customer_payment", {
      p_customer_id: input.customer_id,
      p_payment_date: input.payment_date,
      p_amount: input.amount,
      p_currency_code: input.currency_code,
      p_payment_method: input.payment_method,
      p_reference_number: input.reference_number ?? null,
      p_notes: input.notes ?? null,
      p_allocations: allocations,
      p_organization_id: idempotency.organizationId,
      p_branch_id: idempotency.branchId,
      p_actor_user_id: idempotency.actorUserId,
      p_service_principal: idempotency.servicePrincipalId,
      p_operation_scope: idempotency.operation,
      p_idempotency_key: idempotency.idempotencyKey,
      p_request_fingerprint: idempotency.requestFingerprint,
    });

    if (error) throw databaseError(error, "Customer payment");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(502, "INVALID_DATABASE_RESPONSE", "Customer payment returned an invalid response");
    const result = data as unknown as CustomerPaymentResult;
    if (!result.payment || !Array.isArray(result.allocations)) throw new ApiError(502, "INVALID_DATABASE_RESPONSE", "Customer payment response is incomplete");
    return result;
  }
}
