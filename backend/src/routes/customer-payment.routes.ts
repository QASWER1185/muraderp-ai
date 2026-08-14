import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import {
  SupabaseCustomerPaymentService,
  type CustomerPaymentInput,
  type CustomerPaymentService,
} from "../services/customer-payment.service.js";

const idSchema = z.coerce.number().int().positive();
const paymentMethodSchema = z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"]);
const allocationSchema = z.strictObject({
  invoice_id: idSchema,
  amount: z.number().finite().positive(),
});
const paymentSchema = z.strictObject({
  customer_id: idSchema,
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(),
  currency_code: z.string().trim().min(3).max(10),
  payment_method: paymentMethodSchema,
  reference_number: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().min(1).max(2_000).optional(),
  allocations: z.array(allocationSchema).min(1).max(100),
}).superRefine((value, context) => {
  const allocationTotal = value.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (Math.abs(allocationTotal - value.amount) > 0.000001) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allocations"],
      message: "Payment amount must equal the total invoice allocations",
    });
  }
});

function normalizedPaymentForFingerprint(input: CustomerPaymentInput): CustomerPaymentInput {
  return {
    ...input,
    currency_code: input.currency_code.trim().toUpperCase(),
    reference_number: input.reference_number?.trim(),
    notes: input.notes?.trim(),
    allocations: [...input.allocations]
      .sort((left, right) => left.invoice_id - right.invoice_id)
      .map((allocation) => ({
        invoice_id: allocation.invoice_id,
        amount: allocation.amount,
      })),
  };
}

function paymentFingerprint(input: CustomerPaymentInput): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizedPaymentForFingerprint(input)), "utf8")
    .digest("hex");
}

export function createCustomerPaymentRouter(
  internalApiToken: string | undefined,
  internalApiPrincipalId: string,
  service: CustomerPaymentService = new SupabaseCustomerPaymentService(),
): Router {
  const router = Router();
  const authorize: RequestHandler = createInternalApiAuth(internalApiToken);

  router.post("/", authorize, async (request, response) => {
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    }

    const parsedInput = paymentSchema.parse(request.body) as CustomerPaymentInput;
    const normalizedInput = normalizedPaymentForFingerprint(parsedInput);
    const result = await service.recordPayment(normalizedInput, {
      principalScope: internalApiPrincipalId,
      operation: "customer-payment.create",
      idempotencyKey,
      requestFingerprint: paymentFingerprint(parsedInput),
    });

    response.status(201).json({ data: result });
  });

  return router;
}
