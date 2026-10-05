import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors/api-error.js";
import { CopilotAgent } from "../copilot-agent.js";
import { readBusinessState, writeBusinessState, newBusinessState } from "./business-state.js";
import { signConversationPayload } from "./conversation.js";
import { fixture, scope, customer, pipe, elbow, call, final } from "./stateful.test-fixtures.js";
import { resolveCandidates } from "../../services/entity-search.service.js";
import { UnifiedCopilotAgent } from "./agent.js";

afterEach(() => vi.useRealTimers());
async function initial(f: ReturnType<typeof fixture>) {
  f.script(call("lookup_customers", { query: "قاسم صاحب لاہور" }), call("set_task_context", { customer_id: 19, brand_hint: "Popular" }), call("begin_estimate_draft"));
  return f.core.run({ message: "قاسم صاحب کے لیے Popular کا مال بناؤ" }, scope);
}
async function withPipe(f: ReturnType<typeof fixture>) {
  const first = await initial(f);
  f.script(call("search_products", { query: "Popular 25mm pipe" }), call("add_draft_item", { quantity: 20 }));
  return f.core.run({ message: "اس میں 25mm pipe کے 20 میٹر ڈال دو", conversationToken: first.conversationToken }, scope);
}

describe("unified stateful business conversation", () => {
  it("retains customer, brand and products, builds one Urdu estimate and prepares it without writes", async () => {
    const f = fixture();
    let result = await withPipe(f);
    const draftId = result.draft!.id;
    expect(result.draft!.totals!.grand_total).toBe(9540);
    f.script(call("search_products", { query: "Popular 25mm female elbow" }), call("add_draft_item", { quantity: 1 }));
    result = await f.core.run({ message: "ایک 25mm female elbow بھی ڈال دو", conversationToken: result.conversationToken }, scope);
    expect(result.draft!.id).toBe(draftId);
    expect(result.draft!.lines.map(line => line.productId)).toEqual([pipe.id, elbow.id]);
    expect(result.draft!.customer?.id).toBe(customer.id);
    f.script(call("update_draft_discount", { percent: 10 }));
    result = await f.core.run({ message: "دونوں میں 10 فیصد discount کر دو", conversationToken: result.conversationToken }, scope);
    expect(result.draft!.totals).toMatchObject({ subtotal: 9740, discount_total: 974, grand_total: 8766 });
    expect(result.answer).toContain("کل رقم: PKR 8766.00");
    expect(result.answer).not.toContain("999999");
    f.script(call("inspect_draft"));
    result = await f.core.run({ message: "قاسم صاحب کو یہ کتنے کا پڑ رہا ہے؟", conversationToken: result.conversationToken }, scope);
    expect(result.draft!.customer?.name).toBe("Qasim sahib");
    f.script(call("prepare_estimate"));
    result = await f.core.run({ message: "ٹھیک ہے، اس کا draft بنا دو", conversationToken: result.conversationToken }, scope);
    expect(result).toMatchObject({ requiresConfirmation: true, draft: { id: draftId, prepared: true } });
    expect(f.erpWrite).not.toHaveBeenCalled();
    expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
    const state = readBusinessState(result.conversationToken, scope);
    expect(state.brandHint).toBe("Popular");
    expect(state.draft!.lines).toHaveLength(2);
    expect(JSON.stringify(state)).not.toMatch(/unit_price|grand_total|999999|turns|assistant/);
  });

  it("corrects quantities, removes lines and recalculates the existing draft", async () => {
    const f = fixture();
    let result = await withPipe(f);
    const id = result.draft!.id, pipeLine = result.draft!.lines[0]!.lineId;
    f.script(call("update_draft_quantity", { line_id: pipeLine, quantity: 25 }));
    result = await f.core.run({ message: "نہیں، 25 میٹر کر دو", conversationToken: result.conversationToken }, scope);
    expect(result.draft).toMatchObject({ id, lines: [{ quantity: 25 }], totals: { grand_total: 11925 } });
    f.script(call("search_products", { query: "female elbow" }), call("add_draft_item", { product_id: 27, quantity: 1 }));
    result = await f.core.run({ message: "ایک elbow بھی ڈال دو", conversationToken: result.conversationToken }, scope);
    const elbowLine = result.draft!.lines.find(line => line.productId === 27)!.lineId;
    f.script(call("remove_draft_item", { line_id: elbowLine }), call("recalculate_draft"));
    result = await f.core.run({ message: "elbow نکال دو، اب total بتاؤ", conversationToken: result.conversationToken }, scope);
    expect(result.draft).toMatchObject({ id, lines: [{ lineId: pipeLine, quantity: 25 }], totals: { grand_total: 11925 } });
    expect(result.draft!.lines).toHaveLength(1);
    f.script(call("prepare_estimate"));
    result = await f.core.run({ message: "اب اسے draft کر دو", conversationToken: result.conversationToken }, scope);
    f.script(call("update_draft_quantity", { line_id: pipeLine, quantity: 20 }));
    result = await f.core.run({ message: "20 meters actually", conversationToken: result.conversationToken }, scope);
    expect(result.requiresConfirmation).toBe(false);
    expect(readBusinessState(result.conversationToken, scope).draft!.preparedRevision).toBeUndefined();
  });

  it("uses the same core for the compatibility CopilotAgent and Phase 1 name", async () => {
    const f = fixture(), facade = new CopilotAgent(f.core);
    expect(facade.core).toBe(f.core);
    const result = await withPipe(f);
    f.script(call("inspect_draft"));
    const next = await facade.respond("اب total بتاؤ", scope, result.conversationToken, result.conversationId);
    expect(next.message).toBe(next.answer);
    expect(next.draft!.id).toBe(result.draft!.id);
    expect(next.toolNames).toEqual(["inspect_draft"]);
  });

  it("merges duplicate products and begins the same draft rather than an unrelated duplicate", async () => {
    const f = fixture();
    let result = await withPipe(f);
    const id = result.draft!.id;
    f.script(call("begin_estimate_draft"), call("add_draft_item", { product_id: 26, quantity: 5 }));
    result = await f.core.run({ message: "اس کے 5 میٹر اور ڈال دو", conversationToken: result.conversationToken }, scope);
    expect(result.draft).toMatchObject({ id, lines: [{ quantity: 25 }] });
    expect(result.draft!.lines).toHaveLength(1);
  });

  it("canonicalizes a case-insensitive unit and caps rounded percentage discounts at the gross amount", async () => {
    const f = fixture(), first = await initial(f);
    const price = await f.services.pricing.resolvePrice({ organization_id: scope.organizationId, product_id: 26, quantity: 1, price_type: "SALE", as_of: "2026-01-01" });
    vi.mocked(f.services.pricing.resolvePrice).mockResolvedValue({ ...price!, unit_price: .006 });
    f.script(call("search_products", { query: "pipe" }), call("add_draft_item", { quantity: 1, unit: "mtr" }), call("update_draft_discount", { percent: 100 }));
    const next = await f.core.run({ message: "Add one meter, then 100% discount", conversationToken: first.conversationToken }, scope);
    expect(next.draft).toMatchObject({ lines: [{ unit: "MTR", discountAmount: .006, amount: 0 }], totals: { grand_total: 0 } });
  });

  it.each(["userId", "organizationId", "branchId"] as const)("rejects another %s before using state", async key => {
    const f = fixture(), result = await withPipe(f);
    const changed = { ...scope, [key]: "44444444-4444-4444-8444-444444444444" };
    expect(() => readBusinessState(result.conversationToken, changed)).toThrow("invalid or expired");
    f.respond.mockClear();
    const next = await f.core.run({ message: "اس کے 20 میٹر", conversationToken: result.conversationToken }, changed);
    expect(next.status).toBe("clarification");
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("binds expiration and conversation identity, and rejects forged prices, totals and entity IDs", async () => {
    const f = fixture(), result = await withPipe(f);
    expect(() => readBusinessState(result.conversationToken + "tamper", scope)).toThrow();
    expect(() => readBusinessState(result.conversationToken, scope, "44444444-4444-4444-8444-444444444444")).toThrow();
    const decoded = readBusinessState(result.conversationToken, scope);
    expect(() => readBusinessState(signConversationPayload({ ...decoded, price: 1, totals: 1 }), scope)).toThrow();
    const forged = decoded; forged.draft!.lines[0]!.productId = 999;
    const body = Buffer.from(JSON.stringify(forged)).toString("base64url");
    const signature = result.conversationToken.split(".")[1];
    expect(() => readBusinessState(body + "." + signature, scope)).toThrow();
    vi.useFakeTimers(); vi.advanceTimersByTime(30 * 60_000 + 1);
    f.respond.mockClear();
    const expired = await f.core.run({ message: "اب total بتاؤ", conversationToken: result.conversationToken }, scope);
    expect(expired.status).toBe("clarification");
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("keeps missing prices unavailable and blocks final preparation without inventing a rate", async () => {
    const f = fixture(); vi.mocked(f.services.pricing.resolvePrice).mockResolvedValue(null);
    let result = await withPipe(f);
    expect(result.draft!.lines[0]).toMatchObject({ rate: null, amount: null });
    expect(result.draft!.totals).toBeNull();
    expect(result.answer).not.toContain("999999");
    f.script(call("prepare_estimate"), final("Saved successfully."));
    result = await f.core.run({ message: "draft بنا دو", conversationToken: result.conversationToken }, scope);
    expect(result.status).toBe("clarification");
    expect(result.requiresConfirmation).toBe(false);
    expect(result.answer).not.toContain("Saved");
    expect(f.erpWrite).not.toHaveBeenCalled();
  });

  it("requires resolved product context and refuses an ambiguous or invented selection", async () => {
    const f = fixture(); const result = await initial(f);
    f.script(call("add_draft_item", { product_id: 999, quantity: 1 }));
    let next = await f.core.run({ message: "اس کے 20 میٹر", conversationToken: result.conversationToken }, scope);
    expect(next.status).toBe("clarification");
    expect(readBusinessState(next.conversationToken, scope).draft!.lines).toEqual([]);
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([
      { ...pipe, category: "Pipe", brandName: "Popular", confidence: .95, match_kind: "fuzzy" }, { ...pipe, id: 28, category: "Pipe", brandName: "Popular", confidence: .95, match_kind: "fuzzy" },
    ], 10));
    f.script(call("search_products", { query: "Popular pipe" }), call("add_draft_item", { product_id: 26, quantity: 1 }));
    next = await f.core.run({ message: "اس کے 20 میٹر", conversationToken: next.conversationToken }, scope);
    expect(next.status).toBe("clarification");
    expect(readBusinessState(next.conversationToken, scope).draft!.lines).toEqual([]);
  });

  it("rejects unauthorized draft operations and exposes no execution tool", async () => {
    const f = fixture(), state = newBusinessState(scope);
    vi.mocked(f.services.tenant.assertPermission).mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "Denied"));
    await expect(f.tools.execute("begin_estimate_draft", {}, scope, state)).rejects.toMatchObject({ status: 403 });
    expect(state.draft).toBeUndefined();
    await expect(f.tools.execute("execute_estimate", {}, scope, state)).rejects.toMatchObject({ code: "UNKNOWN_COPILOT_TOOL" });
    expect(f.tools.definitions().map(tool => tool.name)).not.toContain("confirmAndExecute");
    expect(f.erpWrite).not.toHaveBeenCalled();
  });

  it.each([
    ["add_draft_item", { quantity: -1, unit_price: 1 }],
    ["update_draft_discount", { percent: 101 }],
    ["update_draft_quantity", { line_id: "not-a-line", quantity: 1 }],
  ])("rejects invalid typed inputs for %s", async (name, args) => {
    const f = fixture(), state = newBusinessState(scope);
    await expect(f.tools.execute(name, args, scope, state)).rejects.toMatchObject({ code: "INVALID_COPILOT_TOOL_INPUT" });
  });

  it("bounds lightweight state and never serializes a product catalog", async () => {
    const f = fixture(), result = await withPipe(f);
    expect(result.conversationToken.length).toBeLessThanOrEqual(9000);
    const decoded = readBusinessState(result.conversationToken, scope);
    expect(Object.keys(decoded)).not.toContain("turns");
    expect(writeBusinessState(decoded)).toBe(result.conversationToken);
    expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
  });

  it("stops nested draft reads and state mutation when a pending read outlives the deadline", async () => {
    const f = fixture(), previous = await withPipe(f);
    const state = readBusinessState(previous.conversationToken, scope);
    const line = state.draft!.lines[0]!;
    let release!: () => void;
    vi.mocked(f.services.erp.getProduct).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return pipe as any;
    });
    vi.mocked(f.services.pricing.resolvePrice).mockClear();
    f.script(call("update_draft_quantity", { line_id: line.id, quantity: 25 }));
    const agent = new UnifiedCopilotAgent({ respond: f.respond }, f.tools, 20);
    const result = await agent.run({ message: "25 meters", conversationToken: previous.conversationToken }, scope);
    expect(result.status).toBe("timeout");
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.services.pricing.resolvePrice).not.toHaveBeenCalled();
    expect(readBusinessState(result.conversationToken, scope).draft!.lines[0]!.quantity).toBe(20);
  });
});
