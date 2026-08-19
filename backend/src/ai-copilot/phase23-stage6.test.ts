import { describe, expect, it } from "vitest";
import { createCopilotPlanFromDraft } from "./copilot.service.js";
import { createTransactionActionPlan } from "./transaction-action-planner.js";
import { assertCopilotExecutionContext } from "./transaction-action.gateway.js";
import type { AiDraft } from "../ai-input/contracts.js";
import { evaluateDraftForReview } from "../ai-input/review-policy-v2.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function draft(source: AiDraft["source"], overrides: Partial<AiDraft> = {}): AiDraft {
  return {
    organizationId,
    intent: "estimate",
    source,
    customerId: { value: "101", confidence: 0.98, source },
    lines: [
      {
        productName: { value: "Bestway Cement", confidence: 0.97, source },
        productId: { value: 501, confidence: 0.96, source },
        quantity: { value: 20, confidence: 0.99, source },
        unit: { value: "bag", confidence: 0.99, source },
      },
    ],
    confidence: 0.96,
    requiresHumanConfirmation: true,
    ...overrides,
  };
}

describe("Phase 23 Stage 6 — AI Copilot safety / end-to-end contract", () => {
  it.each(["text", "voice", "image", "camera"] as const)(
    "preserves the %s input source through extraction review into the action plan",
    (source) => {
      const result = createCopilotPlanFromDraft(draft(source), { userId });
      expect(result.requiresConfirmation).toBe(true);
      expect(result.plan.source).toBe(source);
      expect(result.plan.target).toBe("estimate");
      expect(result.plan.lines[0]?.productId).toBe(501);
      expect(result.plan.lines[0]?.quantity).toBe(20);
      expect(result.plan.requiresConfirmation).toBe(true);
    },
  );

  it("never permits an AI draft to bypass human confirmation", () => {
    expect(() =>
      createCopilotPlanFromDraft(draft("text", { requiresHumanConfirmation: false as true }), { userId }),
    ).toThrow("AI transaction drafts must require human confirmation");
  });

  it("requires deterministic product resolution before execution planning", () => {
    const unresolved = draft("text", {
      lines: [
        {
          productName: { value: "Bestway Cement", confidence: 0.97, source: "text" },
          quantity: { value: 20, confidence: 0.99, source: "text" },
        },
      ],
    });
    const { plan } = createCopilotPlanFromDraft(unresolved, { userId });
    expect(plan.lines[0]?.productId).toBeUndefined();
    expect(plan.lines[0]?.rateSource).toBe("UNRESOLVED");
    expect(() =>
      createTransactionActionPlan({
        organizationId,
        userId,
        source: "text",
        target: "estimate",
        customerId: "101",
        lines: [{ productName: "Bestway Cement", quantity: 20 }],
      }),
    ).not.toThrow();
  });

  it("preserves an explicitly supplied user rate as authoritative plan context", () => {
    const { plan } = createCopilotPlanFromDraft(
      draft("voice", {
        lines: [
          {
            productName: { value: "Bestway Cement", confidence: 0.95, source: "voice" },
            productId: { value: 501, confidence: 0.94, source: "voice" },
            quantity: { value: 20, confidence: 0.99, source: "voice" },
            unitRate: { value: 1525, confidence: 0.9, source: "voice" },
          },
        ],
      }),
      { userId, rateListId: 7 },
    );
    expect(plan.lines[0]?.explicitUnitRate).toBe(1525);
    expect(plan.lines[0]?.rateSource).toBe("EXPLICIT_USER_RATE");
    expect(plan.lines[0]?.pricingSelection).toEqual({
      mode: "MANUAL",
      manual_unit_price: 1525,
      source: "MANUAL",
    });
  });

  it("carries a selected Rate List when no explicit user rate exists", () => {
    const { plan } = createCopilotPlanFromDraft(draft("camera"), { userId, rateListId: 9 });
    expect(plan.lines[0]?.rateSource).toBe("SELECTED_RATE_LIST");
    expect(plan.lines[0]?.pricingSelection).toEqual({
      mode: "RATE_LIST",
      rate_list_id: 9,
      source: "INHERITED",
    });
  });

  it("does not invent a price when neither a user rate nor Rate List is supplied", () => {
    const { plan } = createCopilotPlanFromDraft(draft("image"), { userId });
    expect(plan.lines[0]?.explicitUnitRate).toBeUndefined();
    expect(plan.lines[0]?.pricingSelection).toBeUndefined();
    expect(plan.lines[0]?.rateSource).toBe("UNRESOLVED");
  });

  it("requires source-item resolution for customer returns", () => {
    const returnDraft = draft("image", {
      intent: "customer_return",
      documentNumber: { value: "9001", confidence: 0.98, source: "image" },
      lines: [
        {
          productName: { value: "Bestway Cement", confidence: 0.97, source: "image" },
          productId: { value: 501, confidence: 0.96, source: "image" },
          quantity: { value: 2, confidence: 0.99, source: "image" },
        },
      ],
    });
    const { plan } = createCopilotPlanFromDraft(returnDraft, { userId, warehouseId: 3, reason: "Damaged" });
    expect(plan.lines[0]?.sourceItemId).toBeUndefined();
    expect(() => assertCopilotExecutionContext(plan, organizationId, userId)).not.toThrow();
  });

  it("rejects cross-organization execution context", () => {
    const { plan } = createCopilotPlanFromDraft(draft("text"), { userId });
    expect(() =>
      assertCopilotExecutionContext(plan, "33333333-3333-4333-8333-333333333333", userId),
    ).toThrow();
  });

  it("rejects cross-user execution context", () => {
    const { plan } = createCopilotPlanFromDraft(draft("text"), { userId });
    expect(() =>
      assertCopilotExecutionContext(plan, organizationId, "44444444-4444-4444-8444-444444444444"),
    ).toThrow();
  });

  it("keeps the review gate active for a draft even after extraction", () => {
    const review = evaluateDraftForReview({
      draftId: "draft-1",
      source: "voice",
      intent: "estimate.create",
      organizationId,
      userId,
      status: "validated",
      fields: {
        lines: { value: [{ productId: 501 }], confidence: 0.98, source: "voice" },
      },
      requiresConfirmation: true,
    });
    expect(review.requiresHumanConfirmation).toBe(true);
    expect(review.blockingReasons).toEqual([]);
  });
});
