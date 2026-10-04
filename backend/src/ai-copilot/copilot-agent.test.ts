import { describe, expect, it, vi } from "vitest";
import { CopilotAgent } from "./copilot-agent.js";

const context = { userId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", branchId: "33333333-3333-4333-8333-333333333333" };
const product = { id: 25, name: "PPRC Pipe 25mm", sku: "PPRC-25", unit: "length", sale_price: 999 };
const resolvedRate = { product_id: 25, rate_list_id: 8, rate_list_version_id: 9, rate_list_item_id: 10, unit_price: 320, unit: "length", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL", effective_from: "2026-01-01" };

function setup(turns: any[]) {
  const model = { toolTurn: vi.fn(async (_instructions: string, _input: unknown[], _tools: unknown[]) => ({ output: turns.shift() ?? [] })) };
  const access = { assertBranchAccess: vi.fn(async () => {}), assertAuthorized: vi.fn(async () => {}) };
  const erp = {
    listProducts: vi.fn(async () => ({ data: [product], next_cursor: null })),
    getProduct: vi.fn(async () => product),
    getCustomer: vi.fn(async () => null), getVendor: vi.fn(async () => null),
  };
  const pricing = { resolvePrice: vi.fn(async () => resolvedRate) };
  const rateLists = { listRateLists: vi.fn(async () => []), getRateList: vi.fn(async () => null) };
  const runtime = { prepareReview: vi.fn(async () => ({ intent: "estimate", blockingReasons: [], warnings: [], requiresConfirmation: true })) };
  const agent = new CopilotAgent({ model, access, erp, pricing, rateLists, runtime } as any);
  return { agent, model, access, erp, pricing, rateLists, runtime };
}

function call(name: string, args: object, call_id: string) { return [{ type: "function_call", name, arguments: JSON.stringify(args), call_id }]; }
function answer(message: string) { return [{ type: "message", content: [{ type: "output_text", text: message }] }]; }

describe("central Copilot tool loop", () => {
  it("does not present an unverified model answer as a live ERP fact", async () => {
    const { agent } = setup([answer("The pipe costs PKR 1,000.")]);
    const result = await agent.respond("What is the pipe rate?", context);
    expect(result.message).not.toContain("1,000");
    expect(result.toolNames).toEqual([]);
  });

  it("searches products, resolves the live rate, and feeds both results back to the model", async () => {
    const { agent, model, access, erp, pricing } = setup([
      call("search_products", { query: "PPRC 25mm" }, "one"),
      call("get_rate", { productId: 25, quantity: 1, priceType: "SALE", customerId: null, vendorId: null, rateListId: null }, "two"),
      answer("PPRC Pipe 25mm is PKR 320 per length."),
    ]);
    const result = await agent.respond("25mm pipe ka rate batao", context);
    expect(result.message).toContain("PKR 320");
    expect(result.toolNames).toEqual(["search_products", "get_rate"]);
    expect(erp.listProducts).toHaveBeenCalledWith({ search: "PPRC 25mm", limit: 25 }, context.organizationId);
    expect(pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({ organization_id: context.organizationId, product_id: 25, price_type: "SALE" }));
    expect(access.assertAuthorized).toHaveBeenCalledTimes(2);
    const secondInput = model.toolTurn.mock.calls[1]?.[1] as any[];
    expect(secondInput.some((item) => item.type === "function_call_output" && item.output.includes("PPRC Pipe 25mm") && !item.output.includes("999"))).toBe(true);
    const thirdInput = model.toolTurn.mock.calls[2]?.[1] as any[];
    expect(thirdInput.some((item) => item.type === "function_call_output" && item.output.includes("320"))).toBe(true);
  });

  it("returns a product lookup without requiring a draft", async () => {
    const { agent, runtime } = setup([call("get_product", { id: 25 }, "one"), answer("PPRC Pipe 25mm, SKU PPRC-25.")]);
    const result = await agent.respond("Find product 25", context);
    expect(result.review).toBeUndefined();
    expect(runtime.prepareReview).not.toHaveBeenCalled();
  });

  it("prepares an existing mutation review from the original request and never executes it", async () => {
    const { agent, runtime, pricing } = setup([call("prepare_estimate", {}, "one")]);
    const message = "Prepare an estimate for 10 PPRC pipes";
    const result = await agent.respond(message, context);
    expect(result.review).toMatchObject({ intent: "estimate", requiresConfirmation: true });
    expect(runtime.prepareReview).toHaveBeenCalledWith(expect.objectContaining({ organizationId: context.organizationId, userId: context.userId, text: message, intent: "estimate" }), context.branchId);
    expect(pricing.resolvePrice).not.toHaveBeenCalled();
  });

  it("checks branch access before the model sees a request", async () => {
    const { agent, access, model } = setup([]);
    access.assertBranchAccess.mockRejectedValueOnce(new Error("branch denied"));
    await expect(agent.respond("get a product", context)).rejects.toThrow("branch denied");
    expect(model.toolTurn).not.toHaveBeenCalled();
  });

  it("rejects a Rate List outside the requested party scope", async () => {
    const { agent, rateLists, pricing } = setup([
      call("get_rate", { productId: 25, quantity: 1, priceType: "SALE", customerId: null, vendorId: null, rateListId: 7 }, "one"),
      answer("The selected Rate List is unavailable for this context."),
    ]);
    rateLists.getRateList.mockResolvedValueOnce({ id: 7, is_active: true, price_type: "SALE", scope_type: "CUSTOMER", customer_id: 55 } as any);
    await agent.respond("rate from list 7", context);
    expect(pricing.resolvePrice).not.toHaveBeenCalled();
  });
});
