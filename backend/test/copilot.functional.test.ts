import express from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createAiCopilotRouter } from "../src/routes/ai-copilot.routes.js";
import { createCopilotPlanFromDraft } from "../src/ai-copilot/copilot.service.js";

const AUTH_TOKEN = "phase22-test-token-123456789012345678901234567890";
const SERVICE_PRINCIPAL = "muraderp-copilot-test";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const BRANCH_ID = "00000000-0000-4000-8000-000000000004";
const SOURCE = "text" as const;

function field<T>(value: T) {
  return { value, confidence: 0.99, source: SOURCE };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    intent: "estimate",
    source: SOURCE,
    customerId: field("101"),
    lines: [{ productName: field("25mm Popular pipe"), productId: field("25"), quantity: field(50), unit: field("pcs") }],
    confidence: 0.99,
    requiresHumanConfirmation: true,
    ...overrides,
  };
}

describe("Phase 22 Copilot functional contract", () => {
  it("builds a reviewable plan with the selected Rate List", () => {
    const result = createCopilotPlanFromDraft(draft() as any, { userId: USER_ID, rateListId: 7 });
    expect(result.requiresConfirmation).toBe(true);
    expect(result.plan.target).toBe("estimate");
    expect(result.plan.lines[0]?.productId).toBe(25);
    expect(result.plan.lines[0]?.quantity).toBe(50);
    expect(result.plan.lines[0]?.pricingSelection).toEqual({ mode: "RATE_LIST", rate_list_id: 7, source: "INHERITED" });
  });

  it("preserves an explicit user rate instead of replacing it with a Rate List", () => {
    const result = createCopilotPlanFromDraft({
      ...draft(),
      lines: [{ productName: field("25mm Popular pipe"), productId: field("25"), quantity: field(50), unit: field("pcs"), unitRate: field(120) }],
    } as any, { userId: USER_ID, rateListId: 7 });
    expect(result.plan.lines[0]?.explicitUnitRate).toBe(120);
    expect(result.plan.lines[0]?.pricingSelection).toEqual({ mode: "MANUAL", manual_unit_price: 120, source: "MANUAL" });
    expect(result.requiresConfirmation).toBe(true);
  });

  it("rejects an AI draft that attempts to bypass confirmation", () => {
    expect(() => createCopilotPlanFromDraft({ ...draft(), requiresHumanConfirmation: false } as any, { userId: USER_ID }))
      .toThrow("must require human confirmation");
  });

  it("exposes the protected draft/confirm API contract without exposing internal tokens", async () => {
    const runtime = {
      createDraft: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000003", status: "DRAFT" }),
      createMasterDataDraft: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000005", status: "DRAFT" }),
      createRateListDraft: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000006", status: "DRAFT" }),
      createFinancialDraft: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000007", status: "DRAFT" }),
      confirmAndExecute: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000003", status: "EXECUTED" }),
    };
    const app = express();
    app.use(express.json());
    app.use("/test-copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any, SERVICE_PRINCIPAL));

    const draftResponse = await request(app)
      .post("/test-copilot/drafts")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .set("Idempotency-Key", "phase22-copilot-draft-1")
      .send({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        intent: "estimate",
        source: SOURCE,
        customerId: "101",
        rateListId: 7,
        lines: [{ productName: "25mm Popular pipe", productId: "25", quantity: 50, unit: "pcs" }],
        confidence: 0.99,
      });
    expect(draftResponse.status).toBe(201);
    expect(draftResponse.body.requiresConfirmation).toBe(true);
    expect(runtime.createDraft).toHaveBeenCalledOnce();
    expect(runtime.createDraft).toHaveBeenCalledWith(expect.anything(), expect.anything(), "phase22-copilot-draft-1");

    const confirmResponse = await request(app)
      .post("/test-copilot/drafts/00000000-0000-4000-8000-000000000003/confirm")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Organization-Id", ORGANIZATION_ID)
      .set("X-Branch-Id", BRANCH_ID)
      .set("X-User-Id", USER_ID)
      .set("Idempotency-Key", "phase22-copilot-draft-1");
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.executed).toBe(true);
    expect(runtime.confirmAndExecute).toHaveBeenCalledOnce();
    expect(runtime.confirmAndExecute).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000003",
      ORGANIZATION_ID,
      USER_ID,
      "phase22-copilot-draft-1",
      BRANCH_ID,
    );

    const customerDraft = await request(app)
      .post("/test-copilot/master-data/drafts")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .set("Idempotency-Key", "customer-create-1")
      .send({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        intent: "customer_create",
        source: SOURCE,
        name: "Acme Builders",
        phone: "03001234567",
        city: "Lahore",
      });
    expect(customerDraft.status).toBe(201);
    expect(runtime.createMasterDataDraft).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "customer_create", name: "Acme Builders", userId: USER_ID, branchId: BRANCH_ID }),
      "customer-create-1",
    );

    const rateListDraft = await request(app)
      .post("/test-copilot/rate-list/drafts")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .set("Idempotency-Key", "rate-list-create-1")
      .send({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        source: "image",
        rateListId: 7,
        versionNumber: 3,
        effectiveFrom: "2026-09-15T00:00:00.000Z",
        lines: [{ productName: "25mm Popular pipe", productId: 25, minimumQuantity: 10, unit: "pcs", unitRate: 120 }],
      });
    expect(rateListDraft.status).toBe(201);
    expect(runtime.createRateListDraft).toHaveBeenCalledWith(
      expect.objectContaining({ rateListId: 7, versionNumber: 3, userId: USER_ID, branchId: BRANCH_ID }),
      "rate-list-create-1",
    );

    const paymentDraft = await request(app)
      .post("/test-copilot/financial/drafts")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Branch-Id", BRANCH_ID)
      .set("Idempotency-Key", "customer-payment-1")
      .send({
        organizationId: ORGANIZATION_ID, userId: USER_ID, source: "text", intent: "customer_payment",
        customerId: 101, paymentDate: "2026-09-11", amount: 5000, currencyCode: "PKR", paymentMethod: "CASH",
        allocations: [{ invoiceId: 301, amount: 5000 }],
      });
    expect(paymentDraft.status).toBe(201);
    expect(runtime.createFinancialDraft).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "customer_payment", userId: USER_ID, branchId: BRANCH_ID, payment: expect.objectContaining({ customer_id: 101 }) }),
      "customer-payment-1",
    );

    const unauthorized = await request(app)
      .post("/test-copilot/drafts")
      .set("Idempotency-Key", "phase22-copilot-draft-2")
      .send({
        organizationId: ORGANIZATION_ID,
        userId: USER_ID,
        intent: "estimate",
        source: SOURCE,
        customerId: "101",
        lines: [{ productName: "25mm Popular pipe", productId: "25", quantity: 50, unit: "pcs" }],
        confidence: 0.99,
      });
    expect(unauthorized.status).toBe(401);
  });

  it("keeps local Copilot planning performant under a representative burst", () => {
    const start = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      createCopilotPlanFromDraft(draft({
        lines: [{ productName: field(`25mm pipe ${index}`), productId: field("25"), quantity: field(50), unit: field("pcs") }],
      }) as any, { userId: USER_ID, rateListId: 7 });
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
