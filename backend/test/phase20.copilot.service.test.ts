import { describe, expect, it } from "vitest";
import { createCopilotPlanFromDraft, assertCopilotDraftExecution } from "../src/ai-copilot/copilot.service.js";
import type { AiDraft } from "../src/ai-input/contracts.js";

const draft: AiDraft = {
  organizationId: "org-1",
  intent: "estimate",
  source: "voice",
  lines: [
    {
      productName: { value: "Popular Pipe 25mm", confidence: 0.99, source: "voice" },
      quantity: { value: 50, confidence: 0.99, source: "voice" },
      unitRate: { value: 120, confidence: 0.99, source: "voice" },
    },
    {
      productName: { value: "Turk Pipe 25mm", confidence: 0.98, source: "voice" },
      quantity: { value: 25, confidence: 0.99, source: "voice" },
    },
  ],
  confidence: 0.98,
  requiresHumanConfirmation: true,
};

describe("Phase 20 copilot orchestration", () => {
  it("maps AI-extracted lines into a controlled transaction plan", () => {
    const result = createCopilotPlanFromDraft(draft, { userId: "user-1", rateListId: 42 });

    expect(result.requiresConfirmation).toBe(true);
    expect(result.plan.target).toBe("estimate");
    expect(result.plan.lines).toHaveLength(2);
    expect(result.plan.lines[0]?.rateSource).toBe("EXPLICIT_USER_RATE");
    expect(result.plan.lines[1]?.rateSource).toBe("SELECTED_RATE_LIST");
    expect(result.plan.lines[1]?.pricingSelection?.rate_list_id).toBe(42);
  });

  it("refuses drafts that bypass confirmation", () => {
    const unsafe = { ...draft, requiresHumanConfirmation: false as true };
    expect(() => createCopilotPlanFromDraft(unsafe, { userId: "user-1" })).toThrow(
      "AI transaction drafts must require human confirmation",
    );
  });

  it("enforces organization, user, and intent at execution boundary", () => {
    const { plan } = createCopilotPlanFromDraft(draft, { userId: "user-1" });

    expect(() => assertCopilotDraftExecution(plan, "org-1", "user-1", "estimate")).not.toThrow();
    expect(() => assertCopilotDraftExecution(plan, "org-2", "user-1", "estimate")).toThrow(
      "copilot action organization mismatch",
    );
    expect(() => assertCopilotDraftExecution(plan, "org-1", "user-2", "estimate")).toThrow(
      "copilot action user mismatch",
    );
    expect(() => assertCopilotDraftExecution(plan, "org-1", "user-1", "invoice")).toThrow(
      "copilot action intent mismatch",
    );
  });
});
