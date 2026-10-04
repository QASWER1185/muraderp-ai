import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { CopilotReviewService, type CopilotCatalog, type CopilotCatalogRepository } from "../src/ai-copilot/copilot-review.js";
import type { StructuredAiProvider } from "../src/ai-input/openai.provider.js";
import type { PricingService } from "../src/services/pricing.service.js";
import { errorHandler } from "../src/middleware/error-handler.js";
import { createAiCopilotRouter } from "../src/routes/ai-copilot.routes.js";

const AUTH_TOKEN = "phase22-browser-internal-token-123456789012345678901234";
const SERVICE_PRINCIPAL = "muraderp-copilot-test";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const BRANCH_ID = "00000000-0000-4000-8000-000000000004";

const extraction = {
  customerName: "Acme Builders",
  vendorName: null,
  warehouseName: "Main Warehouse",
  documentNumber: "Q-100",
  documentDate: "2026-09-10",
  currencyCode: "PKR",
  lines: [{ productName: "Popular Pipe 25mm", productCode: null, brandHint: "Popular", quantity: 50, unit: "pcs", unitRate: null, confidence: 0.97 }],
  confidence: 0.95,
  warnings: [],
};

const catalog: CopilotCatalog = {
  products: [
    { id: 10, name: "Popular Pipe 25mm", sku: "POP-25", unit: "pcs", brandName: "Popular" },
    { id: 11, name: "Popular Pipe 25mm Heavy", sku: "POP-25-H", unit: "pcs", brandName: "Popular" },
  ],
  customers: [{ id: 20, name: "Acme Builders" }],
  vendors: [],
  warehouses: [{ id: 30, name: "Main Warehouse" }],
  rateLists: [{ id: 40, name: "Popular Sale", code: "POPULAR", priceType: "SALE", scopeType: "GLOBAL", currencyCode: "PKR" }],
};

const provider: StructuredAiProvider = {
  generate: vi.fn().mockResolvedValue(extraction),
  transcribe: vi.fn(),
};

const repository: CopilotCatalogRepository = { getCatalog: vi.fn().mockResolvedValue(catalog) };

describe("Copilot review preparation", () => {
  it("selects a unique exact product name without false ambiguity", async () => {
    const service = new CopilotReviewService(provider, repository);
    const review = await service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", intent: "estimate", text: "Acme Builders: 50 Popular Pipe 25mm" });

    expect(review.intent).toBe("estimate");
    expect(review.customer.selectedId).toBe(20);
    expect(review.warehouse.selectedId).toBe(30);
    expect(review.lines[0]?.product.status).toBe("matched");
    expect(review.lines[0]?.product.candidates.map((candidate) => candidate.id)).toEqual([10, 11]);
    expect(review.lines[0]?.rateList.selectedId).toBe(40);
    expect(review.proposal.requiresHumanConfirmation).toBe(true);
    expect(review.proposal.lines[0]?.productId?.value).toBe("10");
    expect(review.proposal.lines[0]?.productName?.rawText).toBe("Popular");
  });

  it("keeps genuinely duplicate product names ambiguous", async () => {
    const duplicateCatalog = { ...catalog, products: [...catalog.products, { id: 12, name: "Popular Pipe 25mm", sku: "ANOTHER-25", unit: "pcs" }] };
    const service = new CopilotReviewService(provider, { getCatalog: vi.fn().mockResolvedValue(duplicateCatalog) });
    const review = await service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", intent: "estimate", text: "Popular Pipe 25mm" });
    expect(review.lines[0]?.product.status).toBe("ambiguous");
    expect(review.lines[0]?.warnings).toContain("Multiple products match this line; choose one.");
  });

  it("uses the authoritative active sale price and calculates the amount", async () => {
    const price = { rate_list_id: 40, rate_list_version_id: 41, rate_list_item_id: 42, product_id: 10, unit_price: 365, unit: "pcs", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL" as const, effective_from: "2026-09-08T00:00:00.000Z" };
    const pricing = { resolvePrice: vi.fn().mockResolvedValue(price) } as unknown as PricingService;
    const service = new CopilotReviewService(provider, repository, undefined, pricing);
    const review = await service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", intent: "estimate", text: "Acme Builders: 50 Popular Pipe 25mm using Popular Sale." });
    expect(pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ price_type: "SALE", product_id: 10, quantity: 50, rate_list_id: 40 }));
    expect(review.lines[0]).toMatchObject({ resolvedPrice: price, amount: 18250 });
    expect(review.lines[0]?.warnings).toEqual([]);
    expect(review.proposal.lines[0]?.unitRate).toBeUndefined();
  });

  it("asks for attention when the sale rate is missing or the requested unit differs", async () => {
    const pricing = { resolvePrice: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ rate_list_id: 40, rate_list_version_id: 41, rate_list_item_id: 42, product_id: 10, unit_price: 365, unit: "MTR", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-09-08T00:00:00.000Z" }) } as unknown as PricingService;
    const service = new CopilotReviewService(provider, repository, undefined, pricing);
    const input = { organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text" as const, intent: "estimate" as const, text: "50 Popular Pipe 25mm using Popular Sale." };
    const missing = await service.prepare(input);
    expect(missing.lines[0]?.resolvedPrice).toBeUndefined();
    expect(missing.lines[0]?.amount).toBeUndefined();
    expect(missing.blockingReasons.join(" ")).toContain("No current authorized sale rate");
    const unitMismatch = await service.prepare(input);
    expect(unitMismatch.lines[0]?.resolvedPrice).toBeUndefined();
    expect(unitMismatch.blockingReasons.join(" ")).toContain("Sale rate uses MTR");
  });

  it("does not substitute a default price when the named sale list is absent", async () => {
    const pricing = { resolvePrice: vi.fn() } as unknown as PricingService;
    const service = new CopilotReviewService(provider, repository, undefined, pricing);
    const review = await service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", intent: "estimate", text: "50 Popular Pipe 25mm using Store Standard Rates." });
    expect(review.lines[0]?.resolvedPrice).toBeUndefined();
    expect(review.lines[0]?.amount).toBeUndefined();
    expect(review.blockingReasons.join(" ")).toContain("Store Standard Rates");
    expect(pricing.resolvePrice).not.toHaveBeenCalled();
  });

  it("re-quotes the explicitly selected product without retaining product ambiguity", async () => {
    const pricing = { resolvePrice: vi.fn().mockResolvedValue({ rate_list_id: 40, rate_list_version_id: 41, rate_list_item_id: 42, product_id: 10, unit_price: 365, unit: "pcs", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-09-08T00:00:00.000Z" }) } as unknown as PricingService;
    const service = new CopilotReviewService(provider, repository, undefined, pricing);
    const quote = await service.quoteLine({ organizationId: ORGANIZATION_ID, userId: USER_ID, productId: 10, quantity: 2, unit: "pcs", rateListId: 40 });
    expect(quote).toMatchObject({ amount: 730, warning: null });
    expect(pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ product_id: 10, quantity: 2, rate_list_id: 40 }));
  });

  it("rejects an unlabelled direct Invoice request in favor of the native Estimate conversion workflow", async () => {
    const resolver = { resolve: vi.fn().mockResolvedValue({ intent: "invoice.create_draft", decision: "draft", confidence: 0.94, entities: {} }) };
    const service = new CopilotReviewService(provider, repository, resolver);
    await expect(service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", text: "make an invoice for 50 pipes" }))
      .rejects.toMatchObject({ code: "AI_CLARIFICATION_REQUIRED" });

    expect(resolver.resolve).toHaveBeenCalledWith("make an invoice for 50 pipes");
  });

  it("rejects auto intent for media so the document type cannot be guessed", async () => {
    const service = new CopilotReviewService(provider, repository);
    await expect(service.prepare({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "image", media: { mimeType: "image/png", base64: "iVBORw0KGgo=" } })).rejects.toMatchObject({ code: "AI_CLARIFICATION_REQUIRED" });
  });

  it("extracts a supplier Rate List into a reviewable matched-line proposal", async () => {
    const service = new CopilotReviewService(provider, repository);
    const review = await service.prepare({
      organizationId: ORGANIZATION_ID, userId: USER_ID, source: "image", intent: "rate_list_update",
      rateListId: 40, media: { mimeType: "image/png", base64: "iVBORw0KGgo=" },
    });

    expect(review.intent).toBe("rate_list_update");
    expect(review.proposal.requiresHumanConfirmation).toBe(true);
    expect(review.lines).toHaveLength(1);
    expect(review.lines[0]?.rateList.selectedId).toBe(40);
  });
});

describe("Copilot review route", () => {
  it("quotes selected estimate lines through the authenticated read-only boundary", async () => {
    const runtime = { quoteEstimateLine: vi.fn().mockResolvedValue({ amount: 730, warning: null, resolvedPrice: { unit_price: 365, unit: "MTR" } }) };
    const app = express();
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any, SERVICE_PRINCIPAL));
    app.use(errorHandler);
    const result = await request(app).post("/copilot/review/quote")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`).set("X-Branch-Id", BRANCH_ID)
      .send({ organizationId: ORGANIZATION_ID, userId: USER_ID, productId: 10, quantity: 2, unit: "MTR", rateListId: 40 });
    expect(result.status).toBe(200);
    expect(result.body.data.amount).toBe(730);
    expect(runtime.quoteEstimateLine).toHaveBeenCalledWith(expect.objectContaining({ productId: 10, rateListId: 40 }), BRANCH_ID);
  });

  it("keeps review behind authenticated branch context and returns confirmation metadata", async () => {
    const runtime = {
      prepareReview: vi.fn().mockResolvedValue({ reviewId: "review-1", intent: "estimate", requiresConfirmation: true }),
    };
    const app = express();
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any, SERVICE_PRINCIPAL));
    app.use(errorHandler);

    const result = await request(app)
      .post("/copilot/review")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .send({ organizationId: ORGANIZATION_ID, userId: USER_ID, intent: "estimate", source: "text", text: "50 Popular pipes" });

    expect(result.status).toBe(200);
    expect(result.body.requiresConfirmation).toBe(true);
    expect(runtime.prepareReview).toHaveBeenCalledWith(expect.objectContaining({ userId: expect.any(String), intent: "estimate" }), BRANCH_ID);
  });

  it("does not expose direct Invoice creation as a Copilot action", async () => {
    const runtime = { prepareReview: vi.fn() };
    const app = express();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    app.use((request, _response, next) => { (request as any).log = log; next(); });
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any, SERVICE_PRINCIPAL));
    app.use(errorHandler);

    const result = await request(app)
      .post("/copilot/review")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .send({ organizationId: ORGANIZATION_ID, userId: USER_ID, intent: "invoice", source: "text", text: "create an invoice" });

    expect(result.status, log.error.mock.calls.map((call) => (call[0] as any)?.err?.message).join(" | ")).toBe(422);
    expect(result.body.error.code).toBe("COPILOT_INVOICE_NOT_SUPPORTED");
    expect(runtime.prepareReview).not.toHaveBeenCalled();
  });

  it("exposes Invoice document understanding only through a non-executable extraction route", async () => {
    const runtime = {
      prepareInvoiceExtraction: vi.fn().mockResolvedValue({ reviewId: "extract-1", intent: "invoice", lines: [], extractionOnly: true, executable: false }),
    };
    const app = express();
    app.use(express.json());
    app.use("/copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any, SERVICE_PRINCIPAL));
    app.use(errorHandler);

    const result = await request(app)
      .post("/copilot/extract/invoice")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .send({ organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", text: "Invoice 101 has 50 pipes" });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ extractionOnly: true, executable: false });
    expect(runtime.prepareInvoiceExtraction).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }), BRANCH_ID);
  });
});
