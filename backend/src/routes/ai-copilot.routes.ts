import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { CopilotRuntime } from "../ai-copilot/copilot.runtime.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";

const idSchema = z.coerce.number().int().positive();
const draftLineSchema = z.strictObject({ productName: z.string().trim().min(1).max(200), productId: z.union([z.number(), z.string()]).optional(), quantity: z.number().finite().positive(), unit: z.string().trim().min(1).max(50).optional(), unitRate: z.number().finite().nonnegative().optional(), sourceItemId: idSchema.optional(), brandHint: z.string().trim().min(1).max(100).optional() });
const draftSchema = z.strictObject({ organizationId: z.string().uuid(), userId: z.string().uuid().optional(), intent: z.enum(["estimate", "invoice", "customer_return", "supplier_bill", "inventory_adjustment"]), source: z.enum(["text", "image", "camera", "voice"]), customerId: z.string().optional(), vendorId: z.string().optional(), documentNumber: z.string().trim().min(1).max(100).optional(), documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), currencyCode: z.string().trim().min(3).max(10).optional(), warehouseId: idSchema.optional(), rateListId: idSchema.optional(), reason: z.string().trim().min(1).max(2_000).optional(), lines: z.array(draftLineSchema).min(1).max(500), confidence: z.number().finite().min(0).max(1).default(1) });
function headerValue(request: { header(name: string): string | string[] | undefined }, name: string): string | undefined { const value = request.header(name); return Array.isArray(value) ? value[0] : value; }
function toAiDraft(input: z.output<typeof draftSchema>) { return { organizationId: input.organizationId, intent: input.intent, source: input.source, ...(input.customerId ? { customerId: { value: input.customerId, confidence: input.confidence, source: input.source } } : {}), ...(input.vendorId ? { vendorId: { value: input.vendorId, confidence: input.confidence, source: input.source } } : {}), ...(input.documentNumber ? { documentNumber: { value: input.documentNumber, confidence: input.confidence, source: input.source } } : {}), lines: input.lines.map((line) => ({ productName: { value: line.productName, confidence: input.confidence, source: input.source, ...(line.brandHint ? { rawText: line.brandHint } : {}) }, ...(line.productId !== undefined ? { productId: { value: line.productId, confidence: input.confidence, source: input.source } } : {}), quantity: { value: line.quantity, confidence: input.confidence, source: input.source }, ...(line.unit ? { unit: { value: line.unit, confidence: input.confidence, source: input.source } } : {}), ...(line.unitRate !== undefined ? { unitRate: { value: line.unitRate, confidence: input.confidence, source: input.source } } : {}), ...(line.sourceItemId !== undefined ? { sourceItemId: { value: line.sourceItemId, confidence: input.confidence, source: input.source } } : {}) })), confidence: input.confidence, requiresHumanConfirmation: true as const }; }

export function createAiCopilotRouter(internalApiToken?: string, runtime?: CopilotRuntime) {
  const router = Router();
  const authorize = createCopilotAuth(internalApiToken);
  let activeRuntime = runtime;
  const getRuntime = () => { activeRuntime ??= new CopilotRuntime(); return activeRuntime; };

  router.post("/drafts", authorize, async (request, response) => {
    const parsed = draftSchema.parse(request.body);
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const context = { userId, ...(parsed.warehouseId !== undefined ? { warehouseId: parsed.warehouseId } : {}), ...(parsed.rateListId !== undefined ? { rateListId: parsed.rateListId } : {}), ...(parsed.documentNumber !== undefined ? { documentNumber: parsed.documentNumber } : {}), ...(parsed.documentDate !== undefined ? { documentDate: parsed.documentDate } : {}), ...(parsed.currencyCode !== undefined ? { currencyCode: parsed.currencyCode } : {}), ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) };
    const action = await getRuntime().createDraft(toAiDraft(parsed), context, idempotencyKey);
    response.status(201).json({ data: action, requiresConfirmation: true });
  });

  router.post("/drafts/:id/confirm", authorize, async (request, response) => {
    const rawId = request.params.id; const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || !z.string().uuid().safeParse(id).success) throw new ApiError(400, "VALIDATION_ERROR", "A valid Copilot draft id is required");
    const organizationId = z.string().uuid().parse(headerValue(request, "X-Organization-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const requestedUserId = headerValue(request, "X-User-Id");
    const userId = authenticatedUserId ?? z.string().uuid().parse(requestedUserId);
    if (authenticatedUserId && requestedUserId && requestedUserId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const action = await getRuntime().confirmAndExecute(id, organizationId, userId, idempotencyKey);
    response.status(200).json({ data: action, executed: action.status === "EXECUTED" });
  });
  return router;
}
