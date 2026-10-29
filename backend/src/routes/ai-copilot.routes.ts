import { Router } from "express";
import { createCopilotV2Router } from './copilot-v2.routes.js';
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { CopilotRuntime } from "../ai-copilot/copilot.runtime.js";
import type { CopilotAgent } from "../ai-copilot/copilot-agent.js";
import type { ReadOnlyCopilotAgent } from "../ai-copilot/agent/agent.js";
import { ErpToolRegistry } from "../ai-copilot/agent/erp-tools.js";
import { createConversationalTools } from "../ai-copilot/agent/factory.js";
import { readBusinessState } from "../ai-copilot/agent/business-state.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { mediaSchema } from "../ai-input/document-extraction.js";
import type { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { createGeminiUserProvider } from "../ai/providers/factory.js";
import { env } from '../config/env.js';
import type { AiProviderContract } from "../ai/providers/contracts.js";
import { normalizeGeminiApiKey } from "../ai/providers/http.js";
import { isAnalyticsTool } from "../ai-copilot/analytics.js";

const idSchema = z.coerce.number().int().positive();
const draftLineSchema = z.strictObject({ productName: z.string().trim().min(1).max(200), productId: z.union([z.number(), z.string()]).optional(), quantity: z.number().finite().positive(), unit: z.string().trim().min(1).max(50).optional(), unitRate: z.number().finite().nonnegative().optional(), rateListId: idSchema.optional(), sourceItemId: idSchema.optional(), brandHint: z.string().trim().min(1).max(100).optional() });
const draftSchema = z.strictObject({ organizationId: z.string().uuid(), userId: z.string().uuid().optional(), intent: z.enum(["estimate", "invoice", "customer_return", "supplier_bill", "inventory_adjustment"]), source: z.enum(["text", "image", "camera", "voice"]), customerId: z.string().optional(), vendorId: z.string().optional(), documentNumber: z.string().trim().min(1).max(100).optional(), documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), currencyCode: z.string().trim().min(3).max(10).optional(), warehouseId: idSchema.optional(), rateListId: idSchema.optional(), reason: z.string().trim().min(1).max(2_000).optional(), lines: z.array(draftLineSchema).min(1).max(500), confidence: z.number().finite().min(0).max(1).default(1) });
const reviewSchema = z.strictObject({
  organizationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  intent: z.enum(["auto", "estimate", "invoice", "customer_return", "supplier_bill", "inventory_adjustment", "rate_list_update"]).default("auto"),
  source: z.enum(["text", "image", "camera", "voice"]),
  text: z.string().trim().min(1).max(20_000).optional(),
  media: mediaSchema.optional(),
  customerId: idSchema.optional(),
  vendorId: idSchema.optional(),
  warehouseId: idSchema.optional(),
  rateListId: idSchema.optional(),
}).superRefine((value, context) => {
  if (value.source === "text" && !value.text) context.addIssue({ code: "custom", path: ["text"], message: "Text input is required" });
  if (value.source === "voice" && !value.text && !value.media) context.addIssue({ code: "custom", path: ["media"], message: "Voice text or audio is required" });
  if ((value.source === "image" || value.source === "camera") && !value.media) context.addIssue({ code: "custom", path: ["media"], message: "Image or document media is required" });
  if (value.intent === "auto" && value.source !== "text") context.addIssue({ code: "custom", path: ["intent"], message: "Choose an action for voice, image, and camera input" });
});
const quoteSchema = z.strictObject({
  organizationId: z.string().uuid(), userId: z.string().uuid().optional(), productId: idSchema,
  quantity: z.number().finite().positive(), unit: z.string().trim().min(1).max(50),
  customerId: idSchema.optional(), rateListId: idSchema.optional(),
});
const masterDataDraftSchema = z.strictObject({
  organizationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  intent: z.enum(["customer_create", "vendor_create"]),
  source: z.enum(["text", "image", "camera", "voice"]),
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(1).max(50),
  city: z.string().trim().min(1).max(120),
});
const rateListDraftSchema = z.strictObject({
  organizationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  source: z.enum(["text", "image", "camera", "voice"]),
  rateListId: idSchema,
  versionNumber: idSchema,
  effectiveFrom: z.string().datetime({ offset: true }),
  lines: z.array(z.strictObject({
    productName: z.string().trim().min(1).max(200),
    productId: idSchema,
    minimumQuantity: z.number().finite().positive(),
    unit: z.string().trim().min(1).max(50),
    unitRate: z.number().finite().nonnegative(),
  })).min(1).max(500),
});
const customerPaymentDraftSchema = z.strictObject({
  organizationId: z.string().uuid(), userId: z.string().uuid().optional(), source: z.enum(["text", "image", "camera", "voice"]),
  intent: z.literal("customer_payment"), customerId: idSchema, paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(), currencyCode: z.string().trim().min(3).max(10),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"]),
  reference: z.string().trim().min(1).max(200).optional(), notes: z.string().trim().min(1).max(2_000).optional(),
  allocations: z.array(z.strictObject({ invoiceId: idSchema, amount: z.number().finite().positive() })).min(1).max(500),
});
const vendorPaymentDraftSchema = z.strictObject({
  organizationId: z.string().uuid(), userId: z.string().uuid().optional(), source: z.enum(["text", "image", "camera", "voice"]),
  intent: z.literal("vendor_payment"), vendorId: idSchema, paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().finite().positive(), paymentMethod: z.enum(["CASH", "BANK", "OTHER"]),
  reference: z.string().trim().min(1).max(200).optional(), notes: z.string().trim().min(1).max(2_000).optional(),
  allocations: z.array(z.strictObject({ purchaseId: idSchema, amount: z.number().finite().positive() })).min(1).max(500),
});
const financialDraftSchema = z.discriminatedUnion("intent", [customerPaymentDraftSchema, vendorPaymentDraftSchema])
  .superRefine((value, context) => {
    const allocated = value.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (Math.abs(allocated - value.amount) > 0.000001) context.addIssue({ code: "custom", path: ["allocations"], message: "Allocated amount must equal payment amount" });
  });
const invoiceExtractionSchema = z.strictObject({
  organizationId: z.string().uuid(), userId: z.string().uuid().optional(), source: z.enum(["text", "image", "camera", "voice"]),
  text: z.string().trim().min(1).max(20_000).optional(), media: mediaSchema.optional(),
  customerId: idSchema.optional(), warehouseId: idSchema.optional(), rateListId: idSchema.optional(),
}).superRefine((value, context) => {
  if (value.source === "text" && !value.text) context.addIssue({ code: "custom", path: ["text"], message: "Text input is required" });
  if (value.source === "voice" && !value.text && !value.media) context.addIssue({ code: "custom", path: ["media"], message: "Voice text or audio is required" });
  if ((value.source === "image" || value.source === "camera") && !value.media) context.addIssue({ code: "custom", path: ["media"], message: "Image or document media is required" });
});
function headerValue(request: { header(name: string): string | string[] | undefined }, name: string): string | undefined { const value = request.header(name); return Array.isArray(value) ? value[0] : value; }
function userApiKey(request: { header(name: string): string | string[] | undefined }, payloadKey?: unknown): string | undefined {
  const value = headerValue(request, "X-Api-Key")?.trim() || payloadKey;
  if (value === undefined || (typeof value === "string" && !value.trim())) return undefined;
  const provider = headerValue(request, "X-AI-Provider")?.trim().toLowerCase();
  if (provider && provider !== "gemini") throw new ApiError(400, "AI_PROVIDER_UNSUPPORTED", "Copilot browser keys currently support Gemini.");
  return normalizeGeminiApiKey(value);
}
function toAiDraft(input: z.output<typeof draftSchema>) { return { organizationId: input.organizationId, intent: input.intent, source: input.source, ...(input.customerId ? { customerId: { value: input.customerId, confidence: input.confidence, source: input.source } } : {}), ...(input.vendorId ? { vendorId: { value: input.vendorId, confidence: input.confidence, source: input.source } } : {}), ...(input.documentNumber ? { documentNumber: { value: input.documentNumber, confidence: input.confidence, source: input.source } } : {}), lines: input.lines.map((line) => ({ productName: { value: line.productName, confidence: input.confidence, source: input.source, ...(line.brandHint ? { rawText: line.brandHint } : {}) }, ...(line.productId !== undefined ? { productId: { value: line.productId, confidence: input.confidence, source: input.source } } : {}), quantity: { value: line.quantity, confidence: input.confidence, source: input.source }, ...(line.unit ? { unit: { value: line.unit, confidence: input.confidence, source: input.source } } : {}), ...(line.unitRate !== undefined ? { unitRate: { value: line.unitRate, confidence: input.confidence, source: input.source } } : {}), ...(line.rateListId !== undefined ? { rateListId: { value: line.rateListId, confidence: input.confidence, source: input.source } } : {}), ...(line.sourceItemId !== undefined ? { sourceItemId: { value: line.sourceItemId, confidence: input.confidence, source: input.source } } : {}) })), confidence: input.confidence, requiresHumanConfirmation: true as const }; }

export function createAiCopilotRouter(
  internalApiToken?: string,
  runtime?: CopilotRuntime,
  servicePrincipalId?: string,
  _agent?: CopilotAgent,
  _readOnlyAgent?: ReadOnlyCopilotAgent,
  conversationalTools?: ErpToolRegistry,
  _multimodalInput?: MultimodalAgentInput,
  requestProviderFactory: (apiKey: string, fetcher?: typeof fetch) => AiProviderContract = createGeminiUserProvider,
  _requestAgentFactory?: (provider: AiProviderContract) => ReadOnlyCopilotAgent,
) {
  const router = Router();
  // Chat aliases always terminate in v2, before any legacy route registration.
  router.use(createCopilotV2Router({internalApiToken,servicePrincipalId,legacyAliases:true}));
  const payloadKeys = new WeakMap<object, unknown>();
  // Keep optional transport credentials out of strict ERP schemas, model input,
  // signed conversation state, and any later request-body logging.
  router.use((request, _response, next) => {
    if (request.body && typeof request.body === "object" && !Array.isArray(request.body) && Object.hasOwn(request.body, "apiKey")) {
      const { apiKey, ...body } = request.body;
      payloadKeys.set(request, apiKey);
      request.body = body;
    }
    next();
  });
  const authorize = createCopilotAuth(internalApiToken, servicePrincipalId);
  let activeRuntime = runtime;
  const getRuntime = () => { activeRuntime ??= new CopilotRuntime(); return activeRuntime; };
  const runtimeFor = (request: Parameters<typeof userApiKey>[0]) => {
    const provider = providerFor(request);
    return provider ? new CopilotRuntime(undefined, undefined, provider) : getRuntime();
  };
  const providerFor = (request: Parameters<typeof userApiKey>[0]) => {
    const apiKey = userApiKey(request, payloadKeys.get(request));
    return apiKey === undefined ? undefined : requestProviderFactory(apiKey);
  };
  let activeTools = conversationalTools;
  const getConversationalTools = () => { activeTools ??= createConversationalTools(); return activeTools; };
  router.get("/settings", authorize, (request, response) => {
    if (!request.browserPrincipal?.userId) throw new ApiError(401, "UNAUTHORIZED", "A browser user session is required for Copilot settings.");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { serverConfigured: Boolean(env.GEMINI_API_KEY) } });
  });

  router.post("/analytics/:tool",authorize,async(request,response)=>{
    const tool=String(request.params.tool);
    if(!isAnalyticsTool(tool))throw new ApiError(404,"ANALYTICS_TOOL_NOT_FOUND","Unknown analytics report.");
    const body=z.strictObject({organizationId:z.string().uuid(),userId:z.string().uuid().optional(),input:z.unknown().optional()}).parse(request.body);
    const userId=request.browserPrincipal?.userId??body.userId;
    if(!userId)throw new ApiError(401,"UNAUTHORIZED","Authenticated actor is required.");
    if(request.browserPrincipal&&body.userId&&body.userId!==userId)throw new ApiError(403,"FORBIDDEN","Request user does not match the session.");
    const scope={userId,organizationId:body.organizationId,branchId:z.string().uuid().parse(headerValue(request,"X-Branch-Id"))};
    const data=await getConversationalTools().execute(tool,body.input??{},scope);
    response.setHeader("Cache-Control","no-store");response.json({data,requiresConfirmation:false});
  });

  router.post("/settings/test", authorize, async (request, response) => {
    if (!request.browserPrincipal?.userId) throw new ApiError(401, "UNAUTHORIZED", "A browser user session is required for Copilot settings.");
    z.strictObject({}).parse(request.body ?? {});
    let upstreamStatus: number | undefined;
    const observedFetch: typeof fetch = async (input, init) => {
      const result = await fetch(input, init);
      upstreamStatus = result.status;
      return result;
    };
    const key = userApiKey(request, payloadKeys.get(request));
    const provider = key ? requestProviderFactory(key, observedFetch) : createGeminiUserProvider(undefined, observedFetch,{nativeToolsOnly:true});
    const result = await provider.toolTurn("Connection test only. Reply READY. No ERP data or tools are available.",
      [{ role: "user", content: "Reply READY." }], [], { signal: AbortSignal.timeout(30_000) });
    const hasText = result.output.some((item: { type?: string; content?: Array<{ type?: string; text?: string }> }) =>
      item.type === "message" && item.content?.some(part => part.type === "output_text" && part.text?.trim()));
    if (!hasText) throw new ApiError(502, "AI_INVALID_OUTPUT", "The AI provider did not return a usable connection-test response.");
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { connected: true, ...(upstreamStatus === undefined ? {} : { httpStatus: upstreamStatus }) } });
  });

  // Conversational endpoints are implemented exclusively by the v2 router above.

  router.post('/demand-drafts/:id/save',authorize,async(request,response)=>{
    const userId=request.browserPrincipal?.userId;
    if(!userId)throw new ApiError(401,'UNAUTHORIZED','A browser user session is required.');
    const organizationId=z.string().uuid().parse(headerValue(request,'X-Organization-Id'));
    const branchId=z.string().uuid().parse(headerValue(request,'X-Branch-Id'));
    const id=z.string().uuid().parse(request.params.id);
    const saved=await getRuntime().saveDemandDraft(id,{userId,organizationId,branchId});
    response.setHeader('Cache-Control','no-store');response.json({data:saved});
  });
  router.post("/conversation/drafts", authorize, async (request, response) => {
    const userId = request.browserPrincipal?.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "A browser user session is required.");
    const organizationId = z.string().uuid().parse(headerValue(request, "X-Organization-Id"));
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const input = z.strictObject({ conversationToken: z.string().min(1).max(9000), conversationId: z.string().uuid() }).parse(request.body);
    const scope = { userId, organizationId, branchId };
    const state = readBusinessState(input.conversationToken, scope, input.conversationId);
    if (!state.draft || state.draft.preparedRevision !== state.draft.revision) throw new ApiError(422, "DRAFT_NOT_PREPARED", "Prepare the current estimate for review first.");
    const view = await getConversationalTools().drafts.inspect(state, scope);
    const action = await getRuntime().createConversationDraft(state, view);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: action, draft: view, requiresConfirmation: true, executed: false });
  });

  router.post("/conversation/payments", authorize, async (request, response) => {
    const userId = request.browserPrincipal?.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "A browser user session is required.");
    const organizationId = z.string().uuid().parse(headerValue(request, "X-Organization-Id"));
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const input = z.strictObject({ conversationToken: z.string().min(1).max(9000), conversationId: z.string().uuid() }).parse(request.body);
    const scope = { userId, organizationId, branchId };
    const state = readBusinessState(input.conversationToken, scope, input.conversationId);
    if (!state.paymentPreparation) throw new ApiError(422, "PAYMENT_NOT_PREPARED", "Prepare the payment for review first.");
    const business = getConversationalTools().business;
    if (!business) throw new ApiError(503, "BUSINESS_TOOLS_UNAVAILABLE", "Payment preparation is not configured.");
    const preparation = await business.validatePayment(state.paymentPreparation, scope, state);
    // Content and signed identity bind retries to the same payment review. Read
    // refresh/expiry cannot accidentally create a second approval action.
    const idempotencyKey = "conversation-payment-" + createHash("sha256").update(JSON.stringify({
      ...scope, conversationId: state.conversationId, intent: preparation.intent, payment: preparation.payment,
    })).digest("hex");
    const action = await getRuntime().createFinancialDraft({ ...scope, source: state.inputSource??"text", intent: preparation.intent, payment: preparation.payment }, idempotencyKey);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ data: { ...action, idempotencyKey }, paymentPreparation: preparation, requiresConfirmation: true, executed: false });
  });

  router.post("/review", authorize, async (request, response) => {
    const parsed = reviewSchema.parse(request.body);
    if (parsed.intent === "invoice") {
      response.status(422).json({ error: { code: "COPILOT_INVOICE_NOT_SUPPORTED", message: "Create an Estimate, then review and convert it to an Invoice in the native ERP workflow" } });
      return;
    }
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const review = await runtimeFor(request).prepareReview({
      organizationId: parsed.organizationId,
      userId,
      source: parsed.source,
      ...(parsed.intent === "auto" ? {} : { intent: parsed.intent }),
      ...(parsed.text === undefined ? {} : { text: parsed.text }),
      ...(parsed.media === undefined ? {} : { media: parsed.media }),
      ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }),
      ...(parsed.vendorId === undefined ? {} : { vendorId: parsed.vendorId }),
      ...(parsed.warehouseId === undefined ? {} : { warehouseId: parsed.warehouseId }),
      ...(parsed.rateListId === undefined ? {} : { rateListId: parsed.rateListId }),
    }, branchId);
    response.status(200).json({ data: review, requiresConfirmation: true });
  });

  router.post("/review/quote", authorize, async (request, response) => {
    const parsed = quoteSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const quote = await runtimeFor(request).quoteEstimateLine({ organizationId: parsed.organizationId, userId, productId: parsed.productId, quantity: parsed.quantity, unit: parsed.unit, ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }), ...(parsed.rateListId === undefined ? {} : { rateListId: parsed.rateListId }) }, branchId);
    response.status(200).json({ data: quote, requiresConfirmation: true });
  });

  router.post("/extract/invoice", authorize, async (request, response) => {
    const parsed = invoiceExtractionSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const extraction = await runtimeFor(request).prepareInvoiceExtraction({
      organizationId: parsed.organizationId, userId, source: parsed.source,
      ...(parsed.text === undefined ? {} : { text: parsed.text }),
      ...(parsed.media === undefined ? {} : { media: parsed.media }),
      ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }),
      ...(parsed.warehouseId === undefined ? {} : { warehouseId: parsed.warehouseId }),
      ...(parsed.rateListId === undefined ? {} : { rateListId: parsed.rateListId }),
    }, branchId);
    response.status(200).json({ data: extraction, extractionOnly: true, executable: false });
  });

  router.post("/drafts", authorize, async (request, response) => {
    const parsed = draftSchema.parse(request.body);
    if (parsed.intent === "invoice") {
      response.status(422).json({ error: { code: "COPILOT_INVOICE_NOT_SUPPORTED", message: "Copilot cannot create Invoices; use the native Estimate-to-Invoice workflow" } });
      return;
    }
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const context = { userId, branchId, ...(parsed.warehouseId !== undefined ? { warehouseId: parsed.warehouseId } : {}), ...(parsed.rateListId !== undefined ? { rateListId: parsed.rateListId } : {}), ...(parsed.documentNumber !== undefined ? { documentNumber: parsed.documentNumber } : {}), ...(parsed.documentDate !== undefined ? { documentDate: parsed.documentDate } : {}), ...(parsed.currencyCode !== undefined ? { currencyCode: parsed.currencyCode } : {}), ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}) };
    const action = await getRuntime().createDraft(toAiDraft(parsed), context, idempotencyKey);
    response.status(201).json({ data: action, requiresConfirmation: true });
  });

  router.post("/master-data/drafts", authorize, async (request, response) => {
    const parsed = masterDataDraftSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const action = await getRuntime().createMasterDataDraft({ ...parsed, userId, branchId }, idempotencyKey);
    response.status(201).json({ data: action, requiresConfirmation: true });
  });

  router.post("/rate-list/drafts", authorize, async (request, response) => {
    const parsed = rateListDraftSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const action = await getRuntime().createRateListDraft({ ...parsed, userId, branchId }, idempotencyKey);
    response.status(201).json({ data: action, requiresConfirmation: true });
  });

  router.post("/financial/drafts", authorize, async (request, response) => {
    const parsed = financialDraftSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const payment = parsed.intent === "customer_payment"
      ? {
        customer_id: parsed.customerId, payment_date: parsed.paymentDate, amount: parsed.amount,
        currency_code: parsed.currencyCode.toUpperCase(), payment_method: parsed.paymentMethod,
        ...(parsed.reference ? { reference_number: parsed.reference } : {}), ...(parsed.notes ? { notes: parsed.notes } : {}),
        allocations: parsed.allocations.map((allocation) => ({ invoice_id: allocation.invoiceId, amount: allocation.amount })),
      }
      : {
        vendor_id: parsed.vendorId, payment_date: parsed.paymentDate, amount: parsed.amount,
        payment_method: parsed.paymentMethod, ...(parsed.reference ? { reference: parsed.reference } : {}),
        ...(parsed.notes ? { notes: parsed.notes } : {}),
        allocations: parsed.allocations.map((allocation) => ({ purchase_id: allocation.purchaseId, amount: allocation.amount })),
      };
    const action = await getRuntime().createFinancialDraft({
      organizationId: parsed.organizationId, userId, branchId, source: parsed.source, intent: parsed.intent, payment,
    }, idempotencyKey);
    response.status(201).json({ data: action, requiresConfirmation: true });
  });

  router.post("/drafts/:id/confirm", authorize, async (request, response) => {
    const rawId = request.params.id; const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || !z.string().uuid().safeParse(id).success) throw new ApiError(400, "VALIDATION_ERROR", "A valid Copilot draft id is required");
    const organizationId = z.string().uuid().parse(headerValue(request, "X-Organization-Id"));
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const requestedUserId = headerValue(request, "X-User-Id");
    const userId = authenticatedUserId ?? z.string().uuid().parse(requestedUserId);
    if (authenticatedUserId && requestedUserId && requestedUserId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const idempotencyKey = headerValue(request, "Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 255) throw new ApiError(400, "VALIDATION_ERROR", "A valid Idempotency-Key header is required");
    const action = await getRuntime().confirmAndExecute(id, organizationId, userId, idempotencyKey, branchId);
    response.status(200).json({ data: action, executed: action.status === "EXECUTED", verified: action.status === "EXECUTED" });
  });
  return router;
}
