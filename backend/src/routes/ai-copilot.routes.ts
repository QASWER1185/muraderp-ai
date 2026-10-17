import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { CopilotRuntime } from "../ai-copilot/copilot.runtime.js";
import { CopilotAgent, createCopilotAgent } from "../ai-copilot/copilot-agent.js";
import { ReadOnlyCopilotAgent } from "../ai-copilot/agent/agent.js";
import { ErpToolRegistry } from "../ai-copilot/agent/erp-tools.js";
import { createConversationalTools } from "../ai-copilot/agent/factory.js";
import { readBusinessState } from "../ai-copilot/agent/business-state.js";
import { createCopilotAuth } from "../middleware/copilot-auth.js";
import { mediaSchema } from "../ai-input/document-extraction.js";
import { MultimodalAgentInput } from "../ai-copilot/agent/multimodal-input.js";
import { writeBusinessState } from "../ai-copilot/agent/business-state.js";

const idSchema = z.coerce.number().int().positive();
const agentRequestSchema = z.strictObject({ message: z.string().trim().min(1).max(4000), conversationToken: z.string().max(9000).optional(), conversationId: z.string().uuid().optional(),selection:z.strictObject({kind:z.enum(["product","customer","vendor"]),id:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)}).optional() });
const chatSchema = z.strictObject({
  organizationId: z.string().uuid(), userId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(20_000),
  conversationToken: z.string().max(9000).optional(), conversationId: z.string().uuid().optional(),
});
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
function toAiDraft(input: z.output<typeof draftSchema>) { return { organizationId: input.organizationId, intent: input.intent, source: input.source, ...(input.customerId ? { customerId: { value: input.customerId, confidence: input.confidence, source: input.source } } : {}), ...(input.vendorId ? { vendorId: { value: input.vendorId, confidence: input.confidence, source: input.source } } : {}), ...(input.documentNumber ? { documentNumber: { value: input.documentNumber, confidence: input.confidence, source: input.source } } : {}), lines: input.lines.map((line) => ({ productName: { value: line.productName, confidence: input.confidence, source: input.source, ...(line.brandHint ? { rawText: line.brandHint } : {}) }, ...(line.productId !== undefined ? { productId: { value: line.productId, confidence: input.confidence, source: input.source } } : {}), quantity: { value: line.quantity, confidence: input.confidence, source: input.source }, ...(line.unit ? { unit: { value: line.unit, confidence: input.confidence, source: input.source } } : {}), ...(line.unitRate !== undefined ? { unitRate: { value: line.unitRate, confidence: input.confidence, source: input.source } } : {}), ...(line.rateListId !== undefined ? { rateListId: { value: line.rateListId, confidence: input.confidence, source: input.source } } : {}), ...(line.sourceItemId !== undefined ? { sourceItemId: { value: line.sourceItemId, confidence: input.confidence, source: input.source } } : {}) })), confidence: input.confidence, requiresHumanConfirmation: true as const }; }

export function createAiCopilotRouter(
  internalApiToken?: string,
  runtime?: CopilotRuntime,
  servicePrincipalId?: string,
  agent?: CopilotAgent,
  readOnlyAgent?: ReadOnlyCopilotAgent,
  conversationalTools?: ErpToolRegistry,
  multimodalInput?: MultimodalAgentInput,
) {
  const router = Router();
  const authorize = createCopilotAuth(internalApiToken, servicePrincipalId);
  let activeRuntime = runtime;
  const getRuntime = () => { activeRuntime ??= new CopilotRuntime(); return activeRuntime; };
  let activeAgent = agent;
  const getAgent = () => { activeAgent ??= createCopilotAgent(); return activeAgent; };
  let activeReadOnlyAgent = readOnlyAgent;
  const getReadOnlyAgent = () => { activeReadOnlyAgent ??= getAgent().core; return activeReadOnlyAgent; };
  let activeTools = conversationalTools;
  const getConversationalTools = () => { activeTools ??= createConversationalTools(); return activeTools; };

  router.post("/agent/input", authorize, async (request, response) => {
    const userId = request.browserPrincipal?.userId;
    if (!userId) throw new ApiError(401,"UNAUTHORIZED","A browser user session is required.");
    const organizationId = z.string().uuid().parse(headerValue(request,"X-Organization-Id"));
    const branchId = z.string().uuid().parse(headerValue(request,"X-Branch-Id"));
    const input = z.strictObject({ source:z.enum(["image","camera","voice"]), media:mediaSchema,
      message:z.string().trim().max(4000).optional(),task:z.enum(["auto","estimate"]).default("auto"),
      conversationToken:z.string().max(9000).optional(),conversationId:z.string().uuid().optional() }).parse(request.body);
    const scope = {userId,organizationId,branchId};
    await getConversationalTools().assertScope(scope);
    const state = readBusinessState(input.conversationToken,scope,input.conversationId);
    state.inputSource=input.source;
    // Any new request invalidates transient preparation, even if OCR needs review.
    delete state.paymentPreparation;
    if (state.draft) delete state.draft.preparedRevision;
    const normalized = await (multimodalInput ??= new MultimodalAgentInput()).normalize(input,scope);
    response.setHeader("Cache-Control","no-store");
    if (normalized.reviewRequired) {
      response.json({data:{answer:"The document needs review. Correct or confirm the extracted wording before continuing; no ERP action was prepared.",
        status:"clarification",conversationToken:writeBusinessState(state),conversationId:state.conversationId,
        extraction:normalized.extraction,reviewText:normalized.message,requiresConfirmation:false,toolNames:[]}});
      return;
    }
    const result = await getReadOnlyAgent().run({message:normalized.message,conversationToken:writeBusinessState(state),conversationId:state.conversationId},scope,request.log);
    response.json({data:{...result,extraction:normalized.extraction},requiresConfirmation:result.requiresConfirmation});
  });

  router.post("/agent", authorize, async (request, response) => {
    const userId = request.browserPrincipal?.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "A browser user session is required for Copilot questions");
    const organizationId = z.string().uuid().parse(headerValue(request, "X-Organization-Id"));
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const parsed = agentRequestSchema.parse(request.body);
    const result = await getReadOnlyAgent().run(parsed, { userId, organizationId, branchId }, request.log);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: result, requiresConfirmation: result.requiresConfirmation });
  });

  router.post("/chat", authorize, async (request, response) => {
    const parsed = chatSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const context = { userId, organizationId: parsed.organizationId, branchId };
    const result = parsed.conversationToken || parsed.conversationId
      ? await getAgent().respond(parsed.message, context, parsed.conversationToken, parsed.conversationId)
      : await getAgent().respond(parsed.message, context);
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ data: result, requiresConfirmation: Boolean(result.review || result.requiresConfirmation) });
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
    const review = await getRuntime().prepareReview({
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
    const quote = await getRuntime().quoteEstimateLine({ organizationId: parsed.organizationId, userId, productId: parsed.productId, quantity: parsed.quantity, unit: parsed.unit, ...(parsed.customerId === undefined ? {} : { customerId: parsed.customerId }), ...(parsed.rateListId === undefined ? {} : { rateListId: parsed.rateListId }) }, branchId);
    response.status(200).json({ data: quote, requiresConfirmation: true });
  });

  router.post("/extract/invoice", authorize, async (request, response) => {
    const parsed = invoiceExtractionSchema.parse(request.body);
    const branchId = z.string().uuid().parse(headerValue(request, "X-Branch-Id"));
    const authenticatedUserId = request.browserPrincipal?.userId;
    const userId = authenticatedUserId ?? parsed.userId;
    if (!userId) throw new ApiError(401, "UNAUTHORIZED", "Authenticated user context is required");
    if (authenticatedUserId && parsed.userId && parsed.userId !== authenticatedUserId) throw new ApiError(403, "FORBIDDEN", "Request user does not match authenticated session");
    const extraction = await getRuntime().prepareInvoiceExtraction({
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
