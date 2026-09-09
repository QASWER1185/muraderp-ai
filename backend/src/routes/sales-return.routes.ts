import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { SupabaseSalesReturnService, type SalesReturnInput, type SalesReturnService } from "../services/sales-return.service.js";
import {
  authoritativeRequestFingerprint,
  requireAuthoritativeTransactionIdentity,
} from "./authoritative-transaction-context.js";

const id = z.coerce.number().int().positive();
const OPERATION = "sales-return.create" as const;
const itemSchema = z.strictObject({ invoice_item_id: id, warehouse_id: id, quantity: z.number().finite().positive() });
const requestSchema = z.strictObject({
  credit_note_number: z.string().trim().min(1).max(100),
  invoice_id: id,
  customer_id: id,
  credit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency_code: z.string().trim().min(3).max(10),
  reason: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2_000).optional(),
  items: z.array(itemSchema).min(1).max(100),
});

function normalizedForFingerprint(input: SalesReturnInput): SalesReturnInput {
  return {
    ...input,
    currency_code: input.currency_code.trim().toUpperCase(),
    reason: input.reason.trim(),
    notes: input.notes?.trim(),
    items: [...input.items].sort((a, b) => a.invoice_item_id - b.invoice_item_id),
  };
}

export function createSalesReturnRouter(
  internalApiToken: string | undefined,
  servicePrincipalId: string | undefined,
  service: SalesReturnService = new SupabaseSalesReturnService(),
): Router {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken, servicePrincipalId);

  router.post("/", authorize, async (request, response) => {
    const identity = requireAuthoritativeTransactionIdentity(request);
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    }
    const input = requestSchema.parse(request.body) as SalesReturnInput;
    const normalizedInput = normalizedForFingerprint(input);
    const result = await service.recordSalesReturn(input, {
      ...identity,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: authoritativeRequestFingerprint(identity, OPERATION, normalizedInput),
    });
    response.status(201).json({ success: true, data: result });
  });
  return router;
}
