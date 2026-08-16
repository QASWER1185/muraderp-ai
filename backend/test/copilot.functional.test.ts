import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createAiCopilotRouter } from "../src/routes/ai-copilot.routes.js";
import { createCopilotPlanFromDraft } from "../src/ai-copilot/copilot.service.js";
import { createApp } from "../src/app.js";

const AUTH_TOKEN = "phase22-test-token-123456789012345678901234567890";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

function draft(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    intent: "estimate",
    source: "text",
    customerId: "101",
    rateListId: 7,
    lines: [{ productName: "25mm Popular pipe", productId: 25, quantity: 50, unit: "pcs" }],
    confidence: 0.99,
    ...overrides,
  };
}

describe("Phase 22 Copilot functional contract", () => {
  it("builds a reviewable plan with the selected Rate List", () => {
    const result = createCopilotPlanFromDraft(draft() as any, {
      userId: USER_ID,
      rateListId: 7,
    });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.plan.target).toBe("estimate");
    expect(result.plan.lines[0]?.productId).toBe(25);
    expect(result.plan.lines[0]?.quantity).toBe(50);
    expect(result.plan.lines[0]?.pricingSelection).toEqual({ mode: "RATE_LIST", rate_list_id: 7 });
  });

  it("preserves an explicit user rate instead of replacing it with a Rate List", () => {
    const result = createCopilotPlanFromDraft({
      ...draft(),
      lines: [{ productName: "25mm Popular pipe", productId: 25, quantity: 50, unit: "pcs", unitRate: 120 }],
    } as any, { userId: USER_ID, rateListId: 7 });

    expect(result.plan.lines[0]?.explicitUnitRate).toBe(120);
    expect(result.plan.lines[0]?.pricingSelection).toEqual({ mode: "MANUAL_OVERRIDE", reason: "Explicit rate supplied by user" });
    expect(result.requiresConfirmation).toBe(true);
  });

  it("rejects an AI draft that attempts to bypass confirmation", () => {
    expect(() => createCopilotPlanFromDraft({ ...draft(), requiresHumanConfirmation: false } as any, { userId: USER_ID }))
      .toThrow("must require human confirmation");
  });

  it("exposes the protected draft/confirm API contract without exposing internal tokens", async () => {
    const runtime = {
      createDraft: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000003", status: "DRAFT" }),
      confirmAndExecute: vi.fn().mockResolvedValue({ id: "00000000-0000-4000-8000-000000000003", status: "EXECUTED" }),
    };
    const app = createApp({ internalApiToken: AUTH_TOKEN });
    app.use("/test-copilot", createAiCopilotRouter(AUTH_TOKEN, runtime as any));

    const draftResponse = await request(app)
      .post("/test-copilot/drafts")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("Idempotency-Key", "phase22-copilot-draft-1")
      .send(draft());

    expect(draftResponse.status).toBe(201);
    expect(draftResponse.body.requiresConfirmation).toBe(true);
    expect(runtime.createDraft).toHaveBeenCalledOnce();

    const confirmResponse = await request(app)
      .post("/test-copilot/drafts/00000000-0000-4000-8000-000000000003/confirm")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .set("X-Organization-Id", ORGANIZATION_ID)
      .set("X-User-Id", USER_ID)
      .set("Idempotency-Key", "phase22-copilot-draft-1");

    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.executed).toBe(true);
    expect(runtime.confirmAndExecute).toHaveBeenCalledOnce();

    const unauthorized = await request(app)
      .post("/test-copilot/drafts")
      .set("Idempotency-Key", "phase22-copilot-draft-2")
      .send(draft());
    expect(unauthorized.status).toBe(401);
  });

  it("keeps local Copilot planning performant under a representative burst", () => {
    const start = performance.now();
    for (let index = 0; index < 1000; index += 1) {
      createCopilotPlanFromDraft(draft({ lines: [{ productName: `25mm pipe ${index}`, productId: 25, quantity: 50, unit: "pcs" }] }) as any, {
        userId: USER_ID,
        rateListId: 7,
      });
    }
    expect(performance.now() - start).toBeLessThan(2000);
  });
});
