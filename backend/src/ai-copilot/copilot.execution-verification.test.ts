import { describe, expect, it, vi } from "vitest";
import { CopilotRuntime, type CopilotRuntimeDependencies } from "./copilot.runtime.js";
import { DefaultCopilotExecutionVerifier } from "../services/copilot-execution-verifier.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const userId = "22222222-2222-4222-8222-222222222222";
const key = "verification-customer-1";

function database() {
  const rows = new Map<string, any>();
  return {
    rows,
    from(table: string) {
      if (table !== "ai_copilot_actions") throw new Error(`unexpected table ${table}`);
      const query: any = { filters: [] as Array<[string, unknown]>, payload: undefined, insertPayload: undefined };
      query.select = () => query;
      query.eq = (field: string, value: unknown) => { query.filters.push([field, value]); return query; };
      query.update = (payload: unknown) => { query.payload = payload; return query; };
      query.insert = (payload: unknown) => { query.insertPayload = payload; return query; };
      query.match = () => [...rows.values()].find((row) => query.filters.every(([field, value]: [string, unknown]) => row[field] === value));
      query.maybeSingle = async () => {
        const row = query.match();
        if (row && query.payload) Object.assign(row, query.payload);
        return { data: row ?? null, error: null };
      };
      query.single = async () => {
        if (query.insertPayload) {
          const row = { id: `action-${rows.size + 1}`, ...query.insertPayload };
          rows.set(row.id, row);
          return { data: row, error: null };
        }
        const row = query.match();
        if (row && query.payload) Object.assign(row, query.payload);
        return { data: row ?? null, error: row ? null : new Error("row missing") };
      };
      query.then = (resolve: (value: unknown) => unknown) => query.maybeSingle().then(resolve);
      return query;
    },
  };
}

function setup() {
  const db = database();
  const persisted = new Map<number, any>();
  const createCustomer = vi.fn(async (input: { name: string; phone: string; city: string }) => {
    const customer = { id: 101, ...input };
    persisted.set(customer.id, customer);
    return customer;
  });
  const getCustomer = vi.fn(async (id: number, organization: string) => {
    expect(organization).toBe(organizationId);
    const checkpoint = db.rows.get("action-1");
    if (getCustomer.mock.calls.length === 1) expect(checkpoint.status).toBe("CONFIRMED");
    expect(checkpoint.result?.id).toBe(101);
    return persisted.get(id) ?? null;
  });
  const erp = { createCustomer, getCustomer } as any;
  const verifier = new DefaultCopilotExecutionVerifier({
    erp, estimates: {} as any, customerPayments: {} as any, vendorPayments: {} as any,
    returns: {} as any, rateLists: {} as any,
  });
  const deps: CopilotRuntimeDependencies = {
    authorization: { assertPermission: vi.fn().mockResolvedValue(undefined) },
    branchAccess: { assertBranchAccess: vi.fn().mockResolvedValue(undefined) },
    references: { assertOwnedReferences: vi.fn().mockResolvedValue(undefined) },
    erp, pricing: {} as any, estimate: {} as any,
    salesTransaction: { execute: vi.fn() }, returns: { recordSalesReturn: vi.fn() },
    verifier, database: () => db,
  };
  const runtime = new CopilotRuntime(erp, deps);
  const createDraft = () => runtime.createMasterDataDraft({
    organizationId, branchId, userId, source: "text", intent: "customer_create",
    name: "Acme Builders", phone: "03001234567", city: "Lahore",
  }, key);
  return { db, persisted, runtime, createDraft, createCustomer, getCustomer };
}

describe("Copilot independent execution verification", () => {
  it("marks success only after the ERP re-read matches", async () => {
    const state = setup();
    const action = await state.createDraft();
    expect(state.createCustomer).not.toHaveBeenCalled();
    const completed = await state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId);
    expect(completed.status).toBe("EXECUTED");
    expect(completed.error_code).toBeNull();
    expect(state.getCustomer).toHaveBeenCalledOnce();
    expect(state.createCustomer).toHaveBeenCalledOnce();
  });

  it("records a mismatch without success and resumes verification without re-execution", async () => {
    const state = setup();
    state.getCustomer.mockImplementationOnce(async () => ({ id: 101, name: "Wrong customer", phone: "03001234567", city: "Lahore" }));
    const action = await state.createDraft();
    await expect(state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId))
      .rejects.toMatchObject({ code: "COPILOT_VERIFICATION_FAILED" });
    expect(state.db.rows.get(action.id)).toMatchObject({ status: "CONFIRMED", result: { id: 101 } });
    expect(state.db.rows.get(action.id).error_code).toContain("Master record name differs");
    const verified = await state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId);
    expect(verified.status).toBe("EXECUTED");
    expect(state.createCustomer).toHaveBeenCalledOnce();
  });

  it("does not verify or retry execution when the authoritative service fails", async () => {
    const state = setup();
    state.createCustomer.mockRejectedValueOnce(new Error("ERP write failed"));
    const action = await state.createDraft();
    await expect(state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId)).rejects.toThrow("ERP write failed");
    expect(state.db.rows.get(action.id).status).toBe("FAILED");
    expect(state.getCustomer).not.toHaveBeenCalled();
    await expect(state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId)).rejects.toThrow("cannot be confirmed from FAILED");
    expect(state.createCustomer).toHaveBeenCalledOnce();
  });

  it("replaying an already verified action re-reads ERP state and never duplicates creation", async () => {
    const state = setup();
    const action = await state.createDraft();
    await state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId);
    const replay = await state.runtime.confirmAndExecute(action.id, organizationId, userId, key, branchId);
    expect(replay.status).toBe("EXECUTED");
    expect(state.createCustomer).toHaveBeenCalledOnce();
    expect(state.getCustomer).toHaveBeenCalledTimes(2);
  });
});
