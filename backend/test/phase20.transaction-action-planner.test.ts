import { describe, expect, it } from "vitest";
import { createTransactionActionPlan } from "../src/ai-copilot/transaction-action-planner.js";

describe("Phase 20 transaction action planner", () => {
  it("preserves explicit user rates as manual pricing", () => {
    const plan = createTransactionActionPlan({
      organizationId: "org-1",
      userId: "user-1",
      source: "voice",
      target: "estimate",
      lines: [
        {
          productName: "Popular Pipe 25mm",
          quantity: 50,
          explicitUnitRate: 120,
        },
      ],
    });

    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.lines[0]?.rateSource).toBe("EXPLICIT_USER_RATE");
    expect(plan.lines[0]?.pricingSelection).toEqual({
      mode: "MANUAL",
      manual_unit_price: 120,
      source: "MANUAL",
    });
  });

  it("uses the selected rate list instead of inventing a rate", () => {
    const plan = createTransactionActionPlan({
      organizationId: "org-1",
      userId: "user-1",
      source: "image",
      target: "invoice",
      lines: [
        {
          productName: "Turk Pipe 25mm",
          brandHint: "Turk",
          quantity: 25,
          rateListId: 42,
        },
      ],
    });

    expect(plan.lines[0]?.rateSource).toBe("SELECTED_RATE_LIST");
    expect(plan.lines[0]?.pricingSelection).toEqual({
      mode: "RATE_LIST",
      rate_list_id: 42,
      source: "AI_SUGGESTED",
    });
    expect(plan.lines[0]?.explicitUnitRate).toBeUndefined();
  });

  it("does not convert an unresolved brand hint into a financial decision", () => {
    const plan = createTransactionActionPlan({
      organizationId: "org-1",
      userId: "user-1",
      source: "camera",
      target: "estimate",
      lines: [
        {
          productName: "Faster Pipe 25mm",
          brandHint: "Faster",
          quantity: 30,
        },
      ],
    });

    expect(plan.lines[0]?.rateSource).toBe("UNRESOLVED_BRAND_HINT");
    expect(plan.lines[0]?.pricingSelection).toBeUndefined();
  });

  it("rejects invalid quantities and rates", () => {
    expect(() =>
      createTransactionActionPlan({
        organizationId: "org-1",
        userId: "user-1",
        source: "text",
        target: "customer_return",
        lines: [{ productName: "Pipe", quantity: 0 }],
      }),
    ).toThrow("quantity must be greater than zero");

    expect(() =>
      createTransactionActionPlan({
        organizationId: "org-1",
        userId: "user-1",
        source: "text",
        target: "estimate",
        lines: [{ productName: "Pipe", quantity: 1, explicitUnitRate: -1 }],
      }),
    ).toThrow("explicitUnitRate must be zero or greater");
  });
});
