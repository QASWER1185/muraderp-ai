import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
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
export interface CustomerPaymentIdempotencyContext {
  principalScope: string;
  operation: "customer-payment.create";
  idempotencyKey: string;
  requestFingerprint: string;
}
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
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", "A related customer or invoice was not found");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", "A payment allocation already exists");
    case "22023": return new ApiError(400, "BUSINESS_RULE_VIOLATION", error.message ?? "The payment violates a business rule");
    case "42501": return new ApiError(503, "DATABASE_ACCESS_DENIED", "Database access is not configured correctly");
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
      p_principal_scope: idempotency.principalScope,
      p_operation: idempotency.operation,
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
