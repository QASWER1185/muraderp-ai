import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { createInternalApiAuth } from "../middleware/internal-api-auth.js";
import { SupabaseSalesReturnService, type SalesReturnInput, type SalesReturnService } from "../services/sales-return.service.js";

const id = z.coerce.number().int().positive();
const itemSchema = z.strictObject({
  invoice_item_id: id,
  warehouse_id: id,
  quantity: z.number().finite().positive(),
});
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

function fingerprint(input: SalesReturnInput): string {
  const normalized = {
    ...input,
    currency_code: input.currency_code.trim().toUpperCase(),
    reason: input.reason.trim(),
    notes: input.notes?.trim(),
    items: [...input.items].sort((a, b) => a.invoice_item_id - b.invoice_item_id),
  };
  return createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

export function createSalesReturnRouter(
  internalApiToken: string | undefined,
  principalId: string | undefined,
  service: SalesReturnService = new SupabaseSalesReturnService(),
): Router {
  const router = Router();
  const authorize = createInternalApiAuth(internalApiToken);

  router.post("/", authorize, async (request, response) => {
    if (!principalId) {
      throw new ApiError(503, "ERP_NOT_CONFIGURED", "Sales return principal is not configured");
    }
    const idempotencyKey = request.header("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    }
    const input = requestSchema.parse(request.body) as SalesReturnInput;
    const result = await service.recordSalesReturn(input, {
      principalScope: principalId,
      operation: "sales-return.create",
      idempotencyKey,
      requestFingerprint: fingerprint(input),
    });
    response.status(201).json({ success: true, data: result });
  });

  return router;
}
