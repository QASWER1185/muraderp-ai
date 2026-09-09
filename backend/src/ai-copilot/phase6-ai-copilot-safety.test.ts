import { describe, expect, it, vi } from "vitest";
import type { AiDraft } from "../ai-input/contracts.js";
import { CopilotRuntime, copilotFingerprint, type CopilotRuntimeDependencies } from "./copilot.runtime.js";
import { createCopilotPlanFromDraft } from "./copilot.service.js";
import type { CopilotActionPlan } from "./copilot.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const otherUserId = "44444444-4444-4444-8444-444444444444";

function draft(overrides: Partial<AiDraft> = {}): AiDraft {
  return {
    organizationId,
    intent: "estimate",
    source: "voice",
    customerId: { value: "101", confidence: 0.99, source: "voice" },
    lines: [
      {
        productName: { value: "Bestway Cement", confidence: 0.98, source: "voice" },
        productId: { value: 501, confidence: 0.98, source: "voice" },
        quantity: { value: 20, confidence: 0.99, source: "voice" },
        unit: { value: "bag", confidence: 0.99, source: "voice" },
        unitRate: { value: 1525, confidence: 0.95, source: "voice" },
      },
    ],
    confidence: 0.98,
    requiresHumanConfirmation: true,
    ...overrides,
  };
}

function fakeDatabase() {
  const rows = new Map<string, any>();
  const from = vi.fn((table: string) => {
    if (table !== "ai_copilot_actions") throw new Error(`unexpected table ${table}`);
    const query: any = {
      _filters: [] as Array<[string, unknown]>,
      _update: undefined,
      _insert: undefined,
      select() { return query; },
      eq(column: string, value: unknown) { query._filters.push([column, value]); return query; },
      findMatch() { return [...rows.values()].find((row) => query._filters.every(([key, value]: [string, unknown]) => row[key] === value)); },
      maybeSingle() {
        const match = query.findMatch();
        if (match && query._update) Object.assign(match, query._update);
        return Promise.resolve({ data: match ?? null, error: null });
      },
      insert(payload: any) { query._insert = payload; return query; },
      update(payload: any) { query._update = payload; return query; },
      single() {
        if (query._update) {
          const match = query.findMatch();
          if (!match) return Promise.resolve({ data: null, error: new Error("row not found") });
          Object.assign(match, query._update);
          return Promise.resolve({ data: match, error: null });
        }
        const row = { id: `action-${rows.size + 1}`, ...query._insert };
        rows.set(row.id, row);
        return Promise.resolve({ data: row, error: null });
      },
    };
    return query;
  });
  return { from, rows };
}

function deps(database: any): CopilotRuntimeDependencies {
  return {
    authorization: { assertPermission: vi.fn().mockResolvedValue(undefined) },
    branchAccess: { assertBranchAccess: vi.fn().mockResolvedValue(undefined) },
    references: { assertOwnedReferences: vi.fn().mockResolvedValue(undefined) },
    erp: {} as any,
    pricing: {} as any,
    estimate: { createDraft: vi.fn().mockResolvedValue({ id: 7001 }) } as any,
    salesTransaction: { execute: vi.fn().mockResolvedValue({ id: 8001 }) },
    returns: { recordSalesReturn: vi.fn().mockResolvedValue({ id: 9001 }) },
    database: () => database,
  };
}

describe("Phase 6 — AI Copilot safety / end-to-end regression", () => {
  it("requires human confirmation and preserves the deterministic action plan boundary", () => {
    const { plan, requiresConfirmation } = createCopilotPlanFromDraft(draft(), { userId });
    expect(requiresConfirmation).toBe(true);
    expect(plan.requiresConfirmation).toBe(true);
    expect(plan.lines[0]?.productId).toBe(501);
    expect(plan.lines[0]?.rateSource).toBe("EXPLICIT_USER_RATE");
    expect(() => createCopilotPlanFromDraft(draft({ requiresHumanConfirmation: false as true }), { userId })).toThrow();
  });

  it("produces a stable fingerprint for semantically identical plans", () => {
    const { plan } = createCopilotPlanFromDraft(draft(), { userId });
    const reordered: CopilotActionPlan = { ...plan, lines: plan.lines.map((line) => ({ ...line })) };
    expect(copilotFingerprint(plan)).toBe(copilotFingerprint(reordered));
  });

  it("creates a DRAFT action and refuses idempotency-key reuse for a different action", async () => {
    const database = fakeDatabase();
    const runtime = new CopilotRuntime({} as any, deps(database));
    const first = await runtime.createDraft(draft(), { userId, branchId }, "idem-1");
    expect(first.status).toBe("DRAFT");
    expect(first.idempotency_key).toBe("idem-1");

    const changed = draft({ lines: [{ ...draft().lines[0]!, quantity: { value: 21, confidence: 0.99, source: "voice" } }] });
    await expect(runtime.createDraft(changed, { userId, branchId }, "idem-1")).rejects.toThrow("Idempotency-Key was reused for a different Copilot action");
  });

  it("rejects idempotency replay by a different user in the same organization", async () => {
    const database = fakeDatabase();
    const runtime = new CopilotRuntime({} as any, deps(database));
    await runtime.createDraft(draft(), { userId, branchId }, "idem-user-boundary");
    await expect(runtime.createDraft(draft(), { userId: otherUserId, branchId }, "idem-user-boundary")).rejects.toThrow("Idempotency-Key belongs to a different Copilot user");
  });

  it("executes only after confirmation, with authorization and persisted state transition", async () => {
    const database = fakeDatabase();
    const runtimeDependencies = deps(database);
    const runtime = new CopilotRuntime({} as any, runtimeDependencies);
    const created = await runtime.createDraft(draft(), { userId, branchId }, "idem-2");

    const result = await runtime.confirmAndExecute(created.id, organizationId, userId, "idem-2", branchId);
    expect(result.status).toBe("EXECUTED");
    expect(runtimeDependencies.authorization.assertPermission).toHaveBeenCalledWith(userId, organizationId, "sales.create");
    expect(runtimeDependencies.branchAccess?.assertBranchAccess).toHaveBeenCalledWith(
      { userId, organizationId },
      branchId,
    );
    expect(runtimeDependencies.references?.assertOwnedReferences).toHaveBeenCalled();
    expect(runtimeDependencies.estimate.createDraft).toHaveBeenCalledTimes(1);
  });

  it("rejects confirmation from the wrong organization or user before execution", async () => {
    const database = fakeDatabase();
    const runtimeDependencies = deps(database);
    const runtime = new CopilotRuntime({} as any, runtimeDependencies);
    const created = await runtime.createDraft(draft(), { userId, branchId }, "idem-3");

    await expect(runtime.confirmAndExecute(created.id, "55555555-5555-4555-8555-555555555555", userId, "idem-3", branchId)).rejects.toThrow("copilot action organization mismatch");
    await expect(runtime.confirmAndExecute(created.id, organizationId, otherUserId, "idem-3", branchId)).rejects.toThrow("copilot action user mismatch");
    await expect(runtime.confirmAndExecute(
      created.id,
      organizationId,
      userId,
      "idem-3",
      "66666666-6666-4666-8666-666666666666",
    )).rejects.toThrow("copilot action branch mismatch");
    expect(runtimeDependencies.estimate.createDraft).not.toHaveBeenCalled();
  });

  it("rejects branch denial and unresolved ownership before persisting a Copilot action", async () => {
    const database = fakeDatabase();
    const runtimeDependencies = deps(database);
    runtimeDependencies.branchAccess!.assertBranchAccess = vi.fn().mockRejectedValue(new Error("branch denied"));
    const runtime = new CopilotRuntime({} as any, runtimeDependencies);

    await expect(runtime.createDraft(draft(), { userId, branchId }, "idem-denied")).rejects.toThrow("branch denied");
    expect(database.from).not.toHaveBeenCalled();

    runtimeDependencies.branchAccess!.assertBranchAccess = vi.fn().mockResolvedValue(undefined);
    runtimeDependencies.references!.assertOwnedReferences = vi.fn().mockRejectedValue(new Error("Product unresolved"));
    await expect(runtime.createDraft(draft(), { userId, branchId }, "idem-unresolved")).rejects.toThrow("Product unresolved");
    expect(database.from).not.toHaveBeenCalled();
  });

  it("revalidates ownership before confirmation with zero authoritative side effects", async () => {
    const database = fakeDatabase();
    const runtimeDependencies = deps(database);
    const runtime = new CopilotRuntime({} as any, runtimeDependencies);
    const created = await runtime.createDraft(draft(), { userId, branchId }, "idem-reference-recheck");
    runtimeDependencies.references!.assertOwnedReferences = vi.fn().mockRejectedValue(new Error("Product unresolved"));

    await expect(runtime.confirmAndExecute(
      created.id,
      organizationId,
      userId,
      "idem-reference-recheck",
      branchId,
    )).rejects.toThrow("Product unresolved");

    expect(runtimeDependencies.estimate.createDraft).not.toHaveBeenCalled();
    expect(database.rows.get(created.id)?.status).toBe("DRAFT");
  });
});
