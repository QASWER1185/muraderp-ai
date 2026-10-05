import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "./copilot.runtime.js";
import { fixture, scope, pipe, customer } from "./agent/stateful.test-fixtures.js";
import { newBusinessState, touchDraft } from "./agent/business-state.js";
import { DefaultCopilotExecutionVerifier } from "../services/copilot-execution-verifier.service.js";
import { DefaultEstimateService } from "../services/estimate.service.js";
import { DefaultEstimatePricingService } from "../services/estimate-pricing.service.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

function setup() {
  const f = fixture(), rows: any[] = [];
  const db = {
    from: vi.fn((table: string) => {
      if (table !== "ai_copilot_actions") throw new Error("Unexpected write table");
      const filters: Array<[string, unknown]> = [];
      let inserting: any, updating: any;
      const match = () => rows.find(row => filters.every(([key, value]) => row[key] === value));
      const query: any = {
        select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        insert: (value: any) => { inserting = value; return query; },
        update: (value: any) => { updating = value; return query; },
        maybeSingle: async () => { const row = match(); if (row && updating) Object.assign(row, updating); return { data: row ?? null, error: null }; },
        single: async () => {
          if (inserting) { const row = { id: "action-" + (rows.length + 1), ...inserting }; rows.push(row); return { data: row, error: null }; }
          const row = match(); if (row && updating) Object.assign(row, updating); return { data: row ?? null, error: row ? null : new Error("Missing row") };
        },
        then: (resolve: any, reject: any) => query.maybeSingle().then(resolve, reject),
      };
      return query;
    }),
  };
  const estimate = { createDraft: vi.fn(async (draft: any, _source?: any, _validate?: (lines: PricedEstimateLine[]) => void) => ({ id: 7001, status: "DRAFT", ...draft })) };
  const verifier = { verify: vi.fn(async () => {}) };
  const access = { assertPermission: vi.fn(async () => {}), assertBranchAccess: vi.fn(async () => {}) };
  const runtime = new CopilotRuntime(f.services.erp as any, {
    authorization: access, branchAccess: access, references: { assertOwnedReferences: vi.fn(async () => {}) },
    erp: f.services.erp, pricing: f.services.pricing, estimate, salesTransaction: { execute: vi.fn() },
    returns: { recordSalesReturn: vi.fn() }, verifier, database: () => db,
  } as any);
  const state = newBusinessState(scope); state.customer = customer;
  const draft = touchDraft(state);
  draft.lines = [{ id: "66666666-6666-4666-8666-666666666666", productId: pipe.id, quantity: 20, unit: "MTR", discountPercent: 10 }];
  draft.preparedRevision = draft.revision;
  const prepare = async () => runtime.createConversationDraft(state, await f.tools.drafts.inspect(state, scope));
  return { f, runtime, state, db, rows, estimate, verifier, prepare };
}

describe("conversational estimate uses the existing approval/execution path", () => {
  it("persists a single idempotent approval action without creating the estimate, then applies the approved discount on confirmation", async () => {
    const s = setup();
    const action = await s.prepare(), retry = await s.prepare();
    expect(retry.id).toBe(action.id);
    expect(s.rows).toHaveLength(1);
    expect(action.status).toBe("DRAFT");
    expect(action.action_plan.lines[0]).toMatchObject({ discountPercent: 10, approvedUnitPrice: 477 });
    expect(action.action_plan.lines[0].explicitUnitRate).toBeUndefined();
    expect(s.estimate.createDraft).not.toHaveBeenCalled();
    const result = await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotencyKey, scope.branchId);
    expect(result.status).toBe("EXECUTED");
    expect(s.estimate.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ product_id: 26, quantity: 20, unit_price: 477, discount_amount: 954, pricing_source: "RESOLVED_RATE" })],
    }), expect.objectContaining({ actor_user_id: scope.userId, branch_id: scope.branchId }), expect.any(Function));
    expect(s.verifier.verify).toHaveBeenCalledOnce();
  });

  it("requires renewed approval when ERP prices change after review", async () => {
    const s = setup(), action = await s.prepare();
    vi.mocked(s.f.services.pricing.resolvePrice).mockResolvedValueOnce({
      product_id: 26, unit_price: 500, unit: "MTR", rate_list_id: 4, rate_list_version_id: 10,
      rate_list_item_id: 26, currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-01-01",
    });
    await expect(s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotencyKey, scope.branchId))
      .rejects.toMatchObject({ code: "DRAFT_PRICE_CHANGED" });
    expect(s.estimate.createDraft).not.toHaveBeenCalled();
    expect(s.verifier.verify).not.toHaveBeenCalled();
  });

  it("blocks a rate change during the estimate service's final repricing before its atomic write", async () => {
    const s = setup(), action = await s.prepare();
    const approved = await s.f.services.pricing.resolvePrice({ organization_id: scope.organizationId, product_id: 26,
      quantity: 20, price_type: "SALE", as_of: "2026-01-01" });
    vi.mocked(s.f.services.pricing.resolvePrice).mockResolvedValueOnce(approved).mockResolvedValueOnce({ ...approved!, unit_price: 500 });
    const createEstimateAtomic = vi.fn();
    const service = new DefaultEstimateService({ createEstimateAtomic } as any, new DefaultEstimatePricingService(s.f.services.pricing));
    s.estimate.createDraft.mockImplementationOnce(async (draft, source, validate) => service.createDraft(draft, source, validate));
    await expect(s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotencyKey, scope.branchId))
      .rejects.toMatchObject({ code: "DRAFT_PRICE_CHANGED" });
    expect(createEstimateAtomic).not.toHaveBeenCalled();
    expect(s.verifier.verify).not.toHaveBeenCalled();
  });

  it("recalculates into a new approval revision after a changed-price rejection", async () => {
    const s = setup(), original = await s.prepare();
    const price = await s.f.services.pricing.resolvePrice({ organization_id: scope.organizationId, product_id: 26, quantity: 20, price_type: "SALE", as_of: "2026-01-01" });
    vi.mocked(s.f.services.pricing.resolvePrice).mockResolvedValue({ ...price!, unit_price: 500 });
    await expect(s.runtime.confirmAndExecute(original.id, scope.organizationId, scope.userId, original.idempotencyKey, scope.branchId))
      .rejects.toMatchObject({ code: "DRAFT_PRICE_CHANGED" });
    const view = await s.f.tools.drafts.execute("recalculate_draft", {}, scope, s.state);
    expect(view).toMatchObject({ prepared: false, totals: { grand_total: 9000 } });
    await s.f.tools.drafts.execute("prepare_estimate", {}, scope, s.state);
    const renewed = await s.prepare();
    expect(renewed.idempotencyKey).not.toBe(original.idempotencyKey);
    expect(renewed.id).not.toBe(original.id);
    expect(s.rows.map(row => row.status)).toEqual(["FAILED", "DRAFT"]);
    expect(s.estimate.createDraft).not.toHaveBeenCalled();
  });

  it.each(["organization", "user", "branch"])("prevents confirmation using a different %s", async kind => {
    const s = setup(), action = await s.prepare(), other = "44444444-4444-4444-8444-444444444444";
    await expect(s.runtime.confirmAndExecute(action.id, kind === "organization" ? other : scope.organizationId,
      kind === "user" ? other : scope.userId, action.idempotencyKey, kind === "branch" ? other : scope.branchId)).rejects.toThrow("mismatch");
    expect(s.estimate.createDraft).not.toHaveBeenCalled();
  });

  it("does not persist an unprepared or incomplete conversation", async () => {
    const s = setup(); delete s.state.draft!.preparedRevision;
    await expect(s.prepare()).rejects.toMatchObject({ code: "DRAFT_NOT_PREPARED" });
    expect(s.rows).toEqual([]);
    expect(s.estimate.createDraft).not.toHaveBeenCalled();
  });

  it.each([954, 0])("independently compares a persisted discount of %s with the approved percentage", async discountAmount => {
    const s = setup(), action = await s.prepare();
    const item = { line_number: 1, product_id: 26, quantity: 20, unit: "MTR", unit_price: 477, discount_amount: discountAmount };
    const result = { id: 7001, status: "DRAFT", definition: { estimate_number: "EST-1" }, lines: [item] };
    const reader = vi.fn(async () => ({ record: { id: 7001, organization_id: scope.organizationId, branch_id: scope.branchId,
      customer_id: 19, estimate_number: "EST-1", status: "DRAFT" }, items: [item] }));
    const verifier = new DefaultCopilotExecutionVerifier({ estimates: { getEstimateAggregate: reader } } as any);
    if (discountAmount === 954) await verifier.verify(action.action_plan, result);
    else await expect(verifier.verify(action.action_plan, result)).rejects.toThrow("Approved estimate discount");
    expect(reader).toHaveBeenCalledWith(7001, scope.organizationId);
  });
});
