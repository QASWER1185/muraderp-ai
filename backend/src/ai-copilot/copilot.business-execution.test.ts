import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime } from "./copilot.runtime.js";
import { businessFixture, customerPayment, vendorPayment, scope } from "./agent/business.test-fixtures.js";
import { DefaultCopilotExecutionVerifier } from "../services/copilot-execution-verifier.service.js";

function setup(intent: "customer_payment" | "vendor_payment") {
  const f = businessFixture(), rows: any[] = [];
  const database = {
    from: (table: string) => {
      if (table !== "ai_copilot_actions") throw new Error("Agent attempted a direct domain write");
      const filters: Array<[string, unknown]> = []; let inserting: any, updating: any;
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
        insert: (value: any) => { inserting = value; return query; },
        update: (value: any) => { updating = value; return query; },
        maybeSingle: async () => {
          const row = rows.find(row => filters.every(([key, value]) => row[key] === value));
          if (row && updating) Object.assign(row, updating);
          return { data: row ?? null, error: null };
        },
        single: async () => {
          if (inserting) { const row = { id: "action-" + (rows.length + 1), ...inserting }; rows.push(row); return { data: row, error: null }; }
          return query.maybeSingle();
        },
        then: (resolve: any, reject: any) => query.maybeSingle().then(resolve, reject),
      };
      return query;
    },
  };
  let persisted: any;
  const read = vi.fn(async () => persisted ? structuredClone(persisted) : null);
  const recordPayment = vi.fn(async (input: any) => {
    persisted = { payment: { id: 701, ...input }, allocations: input.allocations };
    return intent === "customer_payment" ? structuredClone(persisted) : 701;
  });
  const authorization = { assertPermission: vi.fn(async () => {}) };
  const verifier = new DefaultCopilotExecutionVerifier({ customerPayments: { getPayment: read }, vendorPayments: { getPayment: read } } as any);
  const runtime = new CopilotRuntime(f.services.erp as any, {
    authorization, branchAccess: f.services.tenant,
    references: { assertOwnedReferences: vi.fn(async () => {}) },
    erp: f.services.erp, pricing: f.services.pricing, estimate: { createDraft: vi.fn() },
    salesTransaction: { execute: vi.fn() }, returns: { recordSalesReturn: vi.fn() },
    customerPayments: { recordPayment }, vendorPayments: { recordPayment },
    verifier, database: () => database, servicePrincipalId: "copilot-test",
  } as any);
  const prepare = async () => {
    await f.tools.execute(intent === "customer_payment" ? "prepare_customer_payment" : "prepare_vendor_payment",
      intent === "customer_payment" ? customerPayment : vendorPayment, scope, f.state);
    const review = f.state.paymentPreparation!;
    return runtime.createFinancialDraft({ ...scope, source: "text", intent, payment: review.payment }, "signed-review-key");
  };
  return { runtime, f, rows, read, recordPayment, authorization, prepare, corrupt: () => { persisted.payment.amount = 999; }, repair: () => { persisted.payment.amount = 200; } };
}

describe("Part 3 payment review preserves Prepare → Approve → Execute → Verify", () => {
  it.each(["customer_payment", "vendor_payment"] as const)("prepares %s idempotently and executes only via its existing domain service after explicit confirmation", async intent => {
    const s = setup(intent), action = await s.prepare();
    expect((await s.prepare()).id).toBe(action.id);
    expect(s.rows).toHaveLength(1);
    expect(action.status).toBe("DRAFT");
    expect(s.recordPayment).not.toHaveBeenCalled();
    expect(s.read).not.toHaveBeenCalled();
    const result = await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId);
    expect(result.status).toBe("EXECUTED");
    expect(s.recordPayment).toHaveBeenCalledWith(intent === "customer_payment" ? customerPayment : vendorPayment, expect.objectContaining({
      organizationId: scope.organizationId, branchId: scope.branchId, actorUserId: scope.userId,
      servicePrincipalId: "copilot-test", operation: intent === "customer_payment" ? "customer-payment.create" : "vendor-payment.create",
      idempotencyKey: action.idempotency_key, requestFingerprint: expect.any(String),
    }));
    expect(s.read).toHaveBeenCalledWith(scope.organizationId, scope.branchId, 701);
    await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId);
    expect(s.recordPayment).toHaveBeenCalledOnce();
    expect(s.read).toHaveBeenCalledTimes(2);
  });

  it.each(["customer_payment", "vendor_payment"] as const)("keeps a failed independent %s verification checkpoint and retries verification without another payment", async intent => {
    const s = setup(intent), action = await s.prepare();
    s.read.mockImplementation(async () => { throw new Error("Independent ERP read unavailable"); });
    await expect(s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId))
      .rejects.toMatchObject({ code: "COPILOT_VERIFICATION_FAILED" });
    expect(s.rows[0]).toMatchObject({ status: "CONFIRMED", result: intent === "customer_payment" ? expect.objectContaining({ payment: { id: 701, ...customerPayment } }) : 701 });
    s.read.mockImplementation(async () => ({ payment: { id: 701, ...(intent === "customer_payment" ? customerPayment : vendorPayment) }, allocations: (intent === "customer_payment" ? customerPayment : vendorPayment).allocations }));
    const result = await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId);
    expect(result.status).toBe("EXECUTED");
    expect(s.recordPayment).toHaveBeenCalledOnce();
  });

  it("rejects altered persisted amounts and never labels an unverified payment successful", async () => {
    const s = setup("customer_payment"), action = await s.prepare();
    await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId);
    s.corrupt();
    await expect(s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId))
      .rejects.toMatchObject({ code: "COPILOT_VERIFICATION_FAILED" });
    expect(s.rows[0].status).toBe("CONFIRMED");
    s.repair();
    expect((await s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId)).status).toBe("EXECUTED");
    expect(s.recordPayment).toHaveBeenCalledOnce();
  });

  it.each(["organization", "user", "branch", "key"])("blocks confirmation with a different %s before payment execution", async kind => {
    const s = setup("customer_payment"), action = await s.prepare(), other = "44444444-4444-4444-8444-444444444444";
    await expect(s.runtime.confirmAndExecute(action.id, kind === "organization" ? other : scope.organizationId,
      kind === "user" ? other : scope.userId, kind === "key" ? "forged-key" : action.idempotency_key,
      kind === "branch" ? other : scope.branchId)).rejects.toThrow("mismatch");
    expect(s.recordPayment).not.toHaveBeenCalled();
  });

  it("rechecks permission at confirmation after a payment was prepared", async () => {
    const s = setup("vendor_payment"), action = await s.prepare();
    s.authorization.assertPermission.mockRejectedValue(new Error("Permission revoked"));
    await expect(s.runtime.confirmAndExecute(action.id, scope.organizationId, scope.userId, action.idempotency_key, scope.branchId)).rejects.toThrow("Permission revoked");
    expect(s.recordPayment).not.toHaveBeenCalled();
    expect(s.rows[0].status).toBe("DRAFT");
  });
});
