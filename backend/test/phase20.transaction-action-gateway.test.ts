import { describe, expect, it } from "vitest";
import { assertCopilotExecutionContext } from "../src/ai-copilot/transaction-action.gateway.js";
import type { CopilotActionPlan } from "../src/ai-copilot/copilot.types.js";

const plan: CopilotActionPlan = {
  organizationId: "org-1",
  userId: "user-1",
  source: "voice",
  target: "estimate",
  lines: [
    {
      productName: "Popular Pipe 25mm",
      quantity: 50,
      explicitUnitRate: 120,
      rateSource: "EXPLICIT_USER_RATE",
      pricingSelection: {
        mode: "MANUAL",
        manual_unit_price: 120,
        source: "MANUAL",
      },
    },
  ],
  requiresConfirmation: true,
};

describe("Phase 20 transaction execution boundary", () => {
  it("accepts matching organization and user context", () => {
    expect(() => assertCopilotExecutionContext(plan, "org-1", "user-1")).not.toThrow();
  });

  it("rejects cross-organization execution", () => {
    expect(() => assertCopilotExecutionContext(plan, "org-2", "user-1")).toThrow(
      "copilot action organization mismatch",
    );
  });

  it("rejects cross-user execution", () => {
    expect(() => assertCopilotExecutionContext(plan, "org-1", "user-2")).toThrow(
      "copilot action user mismatch",
    );
  });
});
