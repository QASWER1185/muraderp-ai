import { describe, expect, it, vi } from "vitest";
import { BasicInventoryModel, basicInventoryQuery } from "./basic-inventory-model.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { businessFixture, scope, pipe, dura } from "./business.test-fixtures.js";
import { resolveCandidates } from "../../services/entity-search.service.js";

describe("provider-independent authoritative inventory", () => {
  it("returns verified quantities through the same scoped tools without a provider", async () => {
    const f = businessFixture();
    const result = await new UnifiedCopilotAgent(new BasicInventoryModel(), f.tools).run({ message: "Check Popular pipe stock" }, scope);
    expect(result.status).toBe("completed");
    expect(result.toolNames).toContain("query_inventory");
    expect(result.answer).toContain("100");
    expect(f.business.erp.listInventory).toHaveBeenCalledWith(expect.any(Object), scope.organizationId);
    expect(f.respond).not.toHaveBeenCalled();
    expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("reports missing cement as unavailable instead of fabricating a quantity", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([], 5));
    const result = await new UnifiedCopilotAgent(new BasicInventoryModel(), f.tools).run({ message: "Check cement stock" }, scope);
    expect(result.answer).toContain("'cement' کا درست آئٹم نہیں ملا");
    expect(result.answer).not.toMatch(/999/);
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it("continues a signed ambiguous-product selection without requiring an AI key or repeating the search", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([pipe, dura].map(row => ({ ...row, category: "Pipe", brandName: row.id === dura.id ? "Dura" : "Popular", confidence: .9, match_kind: "fuzzy" })), 5));
    const core = new UnifiedCopilotAgent(new BasicInventoryModel(), f.tools);
    const first = await core.run({ message: "Check pipe stock" }, scope);
    expect(first.clarification?.kind).toBe("product");
    const result = await core.run({ message: "Continue the pending request using the selected ERP candidate.", conversationId: first.conversationId, conversationToken: first.conversationToken, selection: { kind: "product", id: pipe.id } }, scope);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("100");
    expect(f.services.search.searchProducts).toHaveBeenCalledOnce();
  });
  it("preserves tenant permission checks", async () => {
    const f = businessFixture(); f.gateway.hasPermission.mockResolvedValue(false);
    await expect(new UnifiedCopilotAgent(new BasicInventoryModel(), f.tools).run({ message: "Check pipe stock" }, scope)).rejects.toMatchObject({ status: 403 });
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it("recognizes Urdu stock wording but leaves compound and write requests to the conversational provider", () => {
    expect(basicInventoryQuery("آپ کے پاس اسٹاک میں 25 ایم ایم کا پائپ کتنا ہے؟")).toContain("پائپ");
    expect(basicInventoryQuery("Check cement stock and Hamdan ledger")).toBeNull();
    expect(basicInventoryQuery("add stock for cement")).toBeNull();
  });
});
