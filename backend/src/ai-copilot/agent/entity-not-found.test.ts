import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors/api-error.js";
import { resolveCandidates } from "../../services/entity-search.service.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { readBusinessState, writeBusinessState } from "./business-state.js";
import { businessFixture, call, final, scope, pipe, customer } from "./business.test-fixtures.js";

describe("missing entities and Copilot failure recovery", () => {
  it("combines resolved cement stock and Hamdan Sahib ledger facts", async () => {
    const f = businessFixture();
    const cement = { ...pipe, name: "Bestway Cement", unit: "BAG" };
    const hamdan = { ...customer, name: "Hamdan Sahib", city: "Demo City" };
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([{ ...cement, category: "Cement", brandName: "Bestway", confidence: 1, match_kind: "exact_name" }], 5));
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([{ ...hamdan, confidence: 1, match_kind: "exact_name" }], 5));
    const product = await f.services.erp.getProduct(pipe.id, scope.organizationId);
    const customerRecord = await f.services.erp.getCustomer(customer.id, scope.organizationId);
    vi.mocked(f.services.erp.getProduct).mockResolvedValue({ ...product!, name: cement.name, unit: cement.unit });
    vi.mocked(f.services.erp.getCustomer).mockResolvedValue({ ...customerRecord!, name: hamdan.name });
    const inventory = await f.business.erp.listInventory({ limit: 10, product_id: pipe.id }, scope.organizationId);
    vi.mocked(f.business.erp.listInventory).mockResolvedValue({ ...inventory, data: inventory.data.map(row => ({ ...row, quantity: 0 })) });
    const stockCall = call("query_inventory", { query: "cement" });
    const ledgerCall = call("query_customer_ledger", { query: "Hamdan Sahib" });
    f.script({ output: [...stockCall.output, ...ledgerCall.output], text: "" }, final("invented balance 999"));
    const result = await f.core.run({ message: "Check cement stock and Hamdan Sahib ledger balance" }, scope);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Bestway Cement");
    expect(result.answer).toContain("0 BAG");
    expect(result.answer).toContain("Hamdan Sahib");
    expect(result.answer).toContain("outstanding 800");
    expect(result.answer).not.toMatch(/999|could not verify|was not found/);
  });

  it("answers both parts of the reported query with bounded tenant-scoped suggestions", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([], 5));
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([], 5));
    f.script(call("query_inventory", { query: "cement" }), call("query_customer_ledger", { query: "Hamdan Sahib" }), final("Stock 999; balance 999"));
    const result = await f.core.run({ message: "Check cement stock and Hamdan Sahib ledger balance", conversationToken: writeBusinessState(f.state) }, scope);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Customer 'Hamdan Sahib' was not found");
    expect(result.answer).toContain("Current customers: Qasim sahib");
    expect(result.answer).toContain("Product 'cement' was not found");
    expect(result.answer).not.toMatch(/999|0 bags|could not verify/);
    expect(f.business.erp.listCustomers).toHaveBeenCalledWith({ limit: 5 }, scope.organizationId);
    expect(f.business.repository.customerLedger).not.toHaveBeenCalled();
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
    const state = readBusinessState(result.conversationToken, scope);
    expect(state.customer).toBeUndefined();
    expect(state.productContext).toBeUndefined();
  });

  it("keeps verified zero stock when the customer is missing", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([], 5));
    const inventory = await f.business.erp.listInventory({ limit: 10, product_id: pipe.id }, scope.organizationId);
    vi.mocked(f.business.erp.listInventory).mockResolvedValue({ ...inventory, data: inventory.data.map(row => ({ ...row, quantity: 0 })) });
    f.script(call("query_customer_ledger", { query: "Hamdan Sahib" }), call("query_inventory", { query: "Popular pipe" }), final("made up"));
    const result = await f.core.run({ message: "stock and Hamdan ledger" }, scope);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("was not found");
    expect(result.answer).toContain("0 MTR");
    expect(result.businessFacts?.map(fact => fact.kind)).toEqual(["entity_not_found", "inventory"]);
  });

  it("includes current customer suggestions when the model uses lookup_customers first", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([], 5));
    f.script(call("lookup_customers", { query: "Hamdan Sahib" }), final("Balance 999"));
    const result = await f.core.run({ message: "Hamdan Sahib ledger" }, scope);
    expect(result.answer).toContain("Current customers: Qasim sahib");
    expect(result.answer).not.toContain("999");
  });

  it("handles an unavailable suggestions read without exposing database errors", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([], 5));
    vi.mocked(f.business.erp.listCustomers).mockRejectedValue(new Error("private connection string"));
    f.script(call("query_customer_ledger", { query: "Hamdan Sahib" }), final("done"));
    const result = await f.core.run({ message: "Hamdan Sahib ledger" }, scope);
    expect(result.answer).toContain("current customer list is unavailable");
    expect(result.answer).not.toContain("private connection");
  });

  it("does not expose customer suggestions without permission", async () => {
    const f = businessFixture();
    f.gateway.hasPermission.mockResolvedValue(false);
    f.script(call("query_customer_ledger", { query: "Hamdan Sahib" }));
    await expect(f.core.run({ message: "Hamdan ledger" }, scope)).rejects.toMatchObject({ status: 403 });
    expect(f.business.erp.listCustomers).not.toHaveBeenCalled();
  });

  it("reports a provider configuration failure and logs only its safe code", async () => {
    const f = businessFixture();
    const logger = { info: vi.fn(), warn: vi.fn() };
    const model = { respond: vi.fn(async () => { throw new ApiError(503, "AI_NOT_CONFIGURED", "private secret"); }) };
    const result = await new UnifiedCopilotAgent(model, f.tools).run({ message: "cement stock" }, scope, logger);
    expect(result.status).toBe("error");
    expect(result.answer).toContain("Copilot API key settings");
    expect(result.answer).not.toContain("private secret");
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "AI_NOT_CONFIGURED" }), "Copilot reasoning failed");
  });

  it("shows sanitized actionable model and request configuration failures", async () => {
    const f = businessFixture();
    const model = { respond: vi.fn(async () => { throw new ApiError(502, "AI_PROVIDER_BAD_REQUEST", "Safe settings guidance"); }) };
    const result = await new UnifiedCopilotAgent(model, f.tools).run({ message: "hello" }, scope);
    expect(result.answer).toContain("Safe settings guidance");
    expect(result.answer).toContain("No ERP action was performed.");
  });

  it("retains authoritative results if the next model turn fails", async () => {
    const f = businessFixture();
    f.respond.mockResolvedValueOnce(call("query_inventory", { query: "Popular pipe" })).mockRejectedValueOnce(new ApiError(502, "AI_PROVIDER_ERROR", "private upstream response"));
    const result = await f.core.run({ message: "pipe stock and Hamdan ledger" }, scope);
    expect(result.answer).toContain("100 MTR");
    expect(result.answer).toContain("verified results available so far");
    expect(result.answer).not.toMatch(/private upstream|could not verify/);
  });
});
