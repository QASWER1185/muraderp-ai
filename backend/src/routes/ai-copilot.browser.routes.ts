import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { env } from "../config/env.js";
import { createSupabaseBrowserAuth, getBrowserAuthPrincipal } from "../auth/supabase-user-auth.js";
import { CopilotRuntime } from "../ai-copilot/copilot.runtime.js";

const idSchema = z.coerce.number().int().positive();
const lineSchema = z.strictObject({
  productName: z.string().trim().min(1).max(200),
  productId: z.union([z.number(), z.string()]),
  quantity: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(50).optional(),
  unitRate: z.number().finite().nonnegative().optional(),
  sourceItemId: idSchema.optional(),
  brandHint: z.string().trim().min(1).max(100).optional(),
});

const browserDraftSchema = z.strictObject({
  intent: z.enum(["estimate", "invoice", "customer_return", "supplier_bill", "inventory_adjustment"]),
  source: z.enum(["text", "image", "camera", "voice"]).default("text"),
  customerId: z.string().optional(),
  vendorId: z.string().optional(),
  documentNumber: z.string().trim().min(1).max(100).optional(),
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  currencyCode: z.string().trim().min(3).max(10).optional(),
  warehouseId: idSchema.optional(),
  rateListId: idSchema.optional(),
  reason: z.string().trim().min(1).max(2_000).optional(),
  lines: z.array(lineSchema).min(1).max(500),
  confidence: z.number().finite().min(0).max(1).default(1),
});

function headerValue(request: { header(name: string): string | string[] | undefined }, name: string): string | undefined {
  const value = request.header(name);
  return Array.isArray(value) ? value[0] : value;
}

function toAiDraft(input: z.output<typeof browserDraftSchema>, organizationId: string) {
  return {
    organizationId,
    intent: input.intent,
    source: input.source,
    ...(input.customerId ? { customerId: { value: input.customerId, confidence: input.confidence, source: input.source } } : {}),
    ...(input.vendorId ? { vendorId: { value: input.vendorId, confidence: input.confidence, source: input.source } } : {}),
    ...(input.documentNumber ? { documentNumber: { value: input.documentNumber, confidence: input.confidence, source: input.source } } : {}),
    ...(input.documentDate ? { documentDate: { value: input.documentDate, confidence: input.confidence, source: input.source } } : {}),
    ...(input.currencyCode ? { currencyCode: { value: input.currencyCode, confidence: input.confidence, source: input.source } } : {}),
    ...(input.warehouseId !== undefined ? { warehouseId: { value: input.warehouseId, confidence: input.confidence, source: input.source } } : {}),
    ...(input.rateListId !== undefined ? { rateListId: { value: input.rateListId, confidence: input.confidence, source: input.source } } : {}),
    ...(input.reason ? { reason: { value: input.reason, confidence: input.confidence, source: input.source } } : {}),
    lines: input.lines.map((line) => ({
      productName: { value: line.productName, confidence: input.confidence, source: input.source, ...(line.brandHint ? { rawText: line.brandHint } : {}) },
      productId: { value: line.productId, confidence: input.confidence, source: input.source },
      quantity: { value: line.quantity, confidence: input.confidence, source: input.source },
      ...(line.unit ? { unit: { value: line.unit, confidence: input.confidence, source: input.source } } : {}),
      ...(line.unitRate !== undefined ? { unitRate: { value: line.unitRate, confidence: input.confidence, source: input.source } } : {}),
      ...(line.sourceItemId !== undefined ? { sourceItemId: { value: line.sourceItemId, confidence: input.confidence, source: input.source } } : {}),
    })),
    confidence: input.confidence,
    requiresHumanConfirmation: true as const,
  };
}

export function createBrowserCopilotRouter(runtime?: CopilotRuntime) {
  const router = Router();
  const authorize = createSupabaseBrowserAuth(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  let activeRuntime = runtime;
  const getRuntime = () => {
    activeRuntime ??= new CopilotRuntime();
    return activeRuntime;
  };

  router.post("/drafts", authorize, async (request, response) => {
    const principal = getBrowserAuthPrincipal(request);
    const parsed = browserDraftSchema.parse(request.body);
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    }

    const context = {
      userId: principal.user.id,
      ...(parsed.warehouseId !== undefined ? { warehouseId: parsed.warehouseId } : {}),
      ...(parsed.rateListId !== undefined ? { rateListId: parsed.rateListId } : {}),
      ...(parsed.documentNumber !== undefined ? { documentNumber: parsed.documentNumber } : {}),
      ...(parsed.documentDate !== undefined ? { documentDate: parsed.documentDate } : {}),
      ...(parsed.currencyCode !== undefined ? { currencyCode: parsed.currencyCode } : {}),
      ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
    };

    const action = await getRuntime().createDraft(
      toAiDraft(parsed, principal.organizationId),
      context,
      idempotencyKey,
    );
    response.status(201).json({ data: action, requiresConfirmation: true, userId: principal.user.id, organizationId: principal.organizationId });
  });

  router.post("/drafts/:id/confirm", authorize, async (request, response) => {
    const principal = getBrowserAuthPrincipal(request);
    const rawId = request.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || !z.string().uuid().safeParse(id).success) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid Copilot draft id is required");
    }
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    }

    const action = await getRuntime().confirmAndExecute(
      id,
      principal.organizationId,
      principal.user.id,
      idempotencyKey,
    );
    response.status(200).json({ data: action, executed: action.status === "EXECUTED" });
  });

  return router;
}
