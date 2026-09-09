import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime, type CopilotRuntimeDependencies } from "./copilot.runtime.js";
import type { CopilotActionPlan } from "./copilot.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";

function databaseFor(row: Record<string, any>) {
  return {
    from(table: string) {
      if (table !== "ai_copilot_actions") throw new Error(`unexpected table ${table}`);
      const query: any = { filters: [] as Array<[string, unknown]>, updatePayload: undefined as Record<string, unknown> | undefined };
      query.select = () => query;
      query.eq = (key: string, value: unknown) => { query.filters.push([key, value]); return query; };
      query.update = (payload: Record<string, unknown>) => { query.updatePayload = payload; return query; };
      query.match = () => query.filters.every(([key, value]: [string, unknown]) => row[key] === value);
      query.maybeSingle = async () => {
        if (!query.match()) return { data: null, error: null };
        if (query.updatePayload) Object.assign(row, query.updatePayload);
        return { data: row, error: null };
      };
      query.then = (resolve: (value: { data: Record<string, any>; error: null }) => unknown) => {
        if (query.updatePayload && query.match()) Object.assign(row, query.updatePayload);
        return Promise.resolve(resolve({ data: row, error: null }));
      };
      return query;
    },
  };
}

describe("Phase 1 Copilot pricing safety", () => {
  it("fails closed when an unresolved brand hint reaches confirmation", async () => {
    const plan: CopilotActionPlan = {
      organizationId,
      branchId,
      userId,
      source: "voice",
      target: "estimate",
      customerId: "7",
      lines: [{ productName: "Popular Cable", productId: 10, brandHint: "Popular", quantity: 1, rateSource: "UNRESOLVED_BRAND_HINT" }],
      requiresConfirmation: true,
    };
    const action = {
      id: "action-phase1",
      organization_id: organizationId,
      user_id: userId,
      idempotency_key: "phase1-key",
      status: "DRAFT",
      action_plan: plan,
    };
    const estimate = { createDraft: vi.fn() };
    const dependencies: CopilotRuntimeDependencies = {
      authorization: { assertPermission: vi.fn().mockResolvedValue(undefined) },
      branchAccess: { assertBranchAccess: vi.fn().mockResolvedValue(undefined) },
      references: { assertOwnedReferences: vi.fn().mockResolvedValue(undefined) },
      erp: {} as any,
      pricing: {} as any,
      estimate: estimate as any,
      salesTransaction: { execute: vi.fn() },
      returns: { recordSalesReturn: vi.fn() },
      database: () => databaseFor(action),
    };
    const runtime = new CopilotRuntime({} as any, dependencies);

    await expect(runtime.confirmAndExecute("action-phase1", organizationId, userId, "phase1-key", branchId))
      .rejects.toMatchObject({ code: "UNRESOLVED_BRAND_HINT" });
    expect(estimate.createDraft).not.toHaveBeenCalled();
    expect(action.status).toBe("FAILED");
  });
});
