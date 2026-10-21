import { describe, expect, it } from "vitest";
import { copilotFingerprint } from "../src/ai-copilot/copilot.runtime.js";
import type { CopilotActionPlan } from "../src/ai-copilot/copilot.types.js";

const plan: CopilotActionPlan = {
  organizationId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  source: "voice",
  target: "estimate",
  customerId: "1",
  warehouseId: 2,
  documentNumber: "EST-001",
  lines: [
    {
      productName: "Popular Pipe 25mm",
      productId: 2,
      quantity: 50,
      explicitUnitRate: 120,
      rateSource: "EXPLICIT_USER_RATE",
      pricingSelection: { mode: "MANUAL", manual_unit_price: 120, source: "MANUAL" },
    },
  ],
  requiresConfirmation: true,
};

describe("Phase 20 Copilot runtime fingerprint", () => {
  it("is deterministic regardless of object key insertion order", () => {
    const reordered: CopilotActionPlan = {
      requiresConfirmation: true,
      lines: plan.lines,
      ...(plan.documentNumber !== undefined ? { documentNumber: plan.documentNumber } : {}),
      ...(plan.warehouseId !== undefined ? { warehouseId: plan.warehouseId } : {}),
      ...(plan.customerId !== undefined ? { customerId: plan.customerId } : {}),
      target: plan.target,
      source: plan.source,
      userId: plan.userId,
      organizationId: plan.organizationId,
    };

    expect(copilotFingerprint(plan)).toMatch(/^[0-9a-f]{64}$/);
    expect(copilotFingerprint(plan)).toBe(copilotFingerprint(reordered));
  });
});
