import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { SupabaseVendorPaymentService, type VendorPaymentInput, type VendorPaymentService } from "../services/vendor-payment.service.js";
import {
  authoritativeRequestFingerprint,
  requireAuthoritativeTransactionIdentity,
} from "./authoritative-transaction-context.js";

const id = z.coerce.number().int().positive();
const OPERATION = "vendor-payment.create" as const;
const allocationSchema = z.strictObject({ purchase_id: id, amount: z.number().finite().positive() });
const requestSchema = z.strictObject({
  vendor_id: id,
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(),
  payment_method: z.enum(["CASH", "BANK", "OTHER"]),
  reference: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().min(1).max(2_000).optional(),
  allocations: z.array(allocationSchema).min(1).max(100),
}).superRefine((value, context) => {
  const total = value.allocations.reduce((sum, item) => sum + item.amount, 0);
  if (Math.abs(total - value.amount) > 0.000001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["allocations"], message: "Payment amount must equal total purchase allocations" });
  }
});

function normalizedForFingerprint(input: VendorPaymentInput): VendorPaymentInput {
  return {
    ...input,
    reference: input.reference?.trim(),
    notes: input.notes?.trim(),
    allocations: [...input.allocations].sort((a, b) => a.purchase_id - b.purchase_id),
  };
}

export function createVendorPaymentRouter(
  internalApiToken: string | undefined,
  servicePrincipalId: string | undefined,
  service: VendorPaymentService = new SupabaseVendorPaymentService(),
): Router {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken, servicePrincipalId);

  router.post("/", authorize, async (request, response) => {
    const identity = requireAuthoritativeTransactionIdentity(request);
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    const input = requestSchema.parse(request.body) as VendorPaymentInput;
    const normalizedInput = normalizedForFingerprint(input);
    const result = await service.recordPayment(input, {
      ...identity,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: authoritativeRequestFingerprint(identity, OPERATION, normalizedInput),
    });
    response.status(201).json({ success: true, data: result });
  });

  return router;
}
