import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Json } from "../types/database.types.js";

export type VendorPaymentMethod = "CASH" | "BANK" | "OTHER";
export interface VendorPaymentAllocationInput { purchase_id: number; amount: number }
export interface VendorPaymentInput {
  vendor_id: number;
  payment_date: string;
  amount: number;
  payment_method: VendorPaymentMethod;
  reference?: string | undefined;
  notes?: string | undefined;
  allocations: VendorPaymentAllocationInput[];
}
export interface VendorPaymentContext {
  principalScope: string;
  operation: "vendor-payment.create";
  idempotencyKey: string;
  requestFingerprint: string;
}
export interface VendorPaymentService {
  recordPayment(input: VendorPaymentInput, context: VendorPaymentContext): Promise<Json>;
}

function mapDatabaseError(error: { code?: string; message?: string }): ApiError {
  switch (error.code) {
    case "P0001": return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was reused for a different vendor payment request");
    case "P0002": return new ApiError(409, "BUSINESS_RULE_VIOLATION", "The vendor payment violates a business rule");
    case "P0003": return new ApiError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "The Idempotency-Key is currently being processed; retry shortly");
    case "22023": return new ApiError(400, "BUSINESS_RULE_VIOLATION", error.message ?? "The vendor payment violates a business rule");
    case "23503": return new ApiError(409, "REFERENCE_CONFLICT", error.message ?? "A related vendor or purchase was not found");
    case "23505": return new ApiError(409, "DUPLICATE_RECORD", "The vendor payment allocation already exists");
    case "42501": return new ApiError(503, "DATABASE_ACCESS_DENIED", "Database access is not configured correctly");
    default: return new ApiError(502, "DATABASE_OPERATION_FAILED", "Vendor payment could not be completed");
  }
}

export class SupabaseVendorPaymentService implements VendorPaymentService {
  constructor(private readonly clientFactory: () => SupabaseClient<any> = getSupabaseAdminClient) {}

  async recordPayment(input: VendorPaymentInput, context: VendorPaymentContext): Promise<Json> {
    const allocations: Json = input.allocations.map((allocation) => ({
      purchase_id: allocation.purchase_id,
      amount: allocation.amount,
    }));

    const { data, error } = await this.clientFactory().rpc("record_vendor_payment", {
      p_vendor_id: input.vendor_id,
      p_amount: input.amount,
      p_payment_method: input.payment_method,
      p_allocations: allocations,
      p_payment_date: input.payment_date,
      p_reference: input.reference ?? null,
      p_notes: input.notes ?? null,
      p_principal_scope: context.principalScope,
      p_idempotency_key: context.idempotencyKey,
      p_request_fingerprint: context.requestFingerprint,
    });

    if (error) throw mapDatabaseError(error);
    if (data === null || typeof data !== "number") {
      throw new ApiError(502, "INVALID_DATABASE_RESPONSE", "Vendor payment returned an invalid database response");
    }
    return data as Json;
  }
}
