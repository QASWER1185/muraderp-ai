import { describe, expect, it, vi } from "vitest";
import { fixture, scope, call, final } from "./stateful.test-fixtures.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { ErpToolRegistry } from "./erp-tools.js";
import { ApiError } from "../../errors/api-error.js";
import type { CopilotRuntime } from "../copilot.runtime.js";
import { resolveCandidates } from "../../services/entity-search.service.js";

const details = { name: "Saleem Sb", phone: "03001234567", city: "Lake City" };
function setup() {
  const f = fixture();
  const createMasterDataDraft = vi.fn(async () => ({ id: "customer-draft" })) as unknown as ReturnType<typeof vi.fn<CopilotRuntime["createMasterDataDraft"]>>;
  const tools = new ErpToolRegistry({ ...f.services, runtime: { createMasterDataDraft } }, true);
  return { ...f, tools, createMasterDataDraft, agent: new UnifiedCopilotAgent({ respond: f.respond }, tools) };
}

describe("recovered customer creation preparation", () => {
  it("continues an unknown customer's estimate into a combined preview without a separate customer or stock step",async()=>{
    const f=fixture();vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([],5));
    const createMasterDataDraft=vi.fn(),createUnifiedDraft=vi.fn(async()=>({intent:"erp_action",tool:"erp_create_estimate",draftId:"55555555-5555-4555-8555-555555555555",idempotencyKey:"combined",preview:{summary:"ارسلان صاحب کا مکمل ایسٹیمیٹ پری ویو تیار ہے۔"}}));
    const tools=new ErpToolRegistry({...f.services,runtime:{createMasterDataDraft,createUnifiedDraft} as any},true);
    const agent=new UnifiedCopilotAgent({respond:f.respond},tools);
    f.script(call("lookup_customers",{query:"Arslan Shahnawaz"}),final("Customer not found"),call("erp_create_estimate",{customerName:"Arslan Shahnawaz",customerAddress:"Ittehad Town",brand:"Dura Max",discountScheme:{percent:50},items:[{name:"Elbow 25mm",qty:3}]}));
    const result=await agent.run({message:"Arslan Shahnawaz, Ittehad Town, Dura Max 50% estimate"},scope);
    expect(result).toMatchObject({status:"completed",requiresConfirmation:true,review:{tool:"erp_create_estimate"}});
    expect(result.answer).not.toContain("Customer not found");expect(createMasterDataDraft).not.toHaveBeenCalled();expect(createUnifiedDraft).toHaveBeenCalledOnce();
    for(const [,definitions] of f.respond.mock.calls)expect((definitions as any[]).map(tool=>tool.name)).not.toContain("prepare_customer_create");
  });
  it("collects required details without preparing or creating a customer", async () => {
    const f = setup(); f.script(final("Need more details"));
    const result = await f.agent.run({ message: "Saleem ko new customer add karo" }, scope);
    expect(result).toMatchObject({ status: "clarification", preparation: { intent: "customer_create", requiredFields: ["name", "phone", "city"] }, requiresConfirmation: false });
    expect(f.createMasterDataDraft).not.toHaveBeenCalled();
    expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("prepares a scoped approval draft and returns its server ID/key without executing creation", async () => {
    const f = setup(); f.script(call("prepare_customer_create", details));
    const result = await f.agent.run({ message: "Prepare a new customer for review: " + JSON.stringify(details) }, scope);
    expect(result).toMatchObject({ status: "completed", requiresConfirmation: true, review: { ...details, draftId: "customer-draft", intent: "customer_create", requiresConfirmation: true } });
    expect(f.createMasterDataDraft).toHaveBeenCalledWith({ ...scope, ...details, source: "text", intent: "customer_create" }, expect.stringMatching(/^copilot-customer-/));
    expect(f.services.tenant.assertPermission).toHaveBeenCalledWith({ userId: scope.userId, organizationId: scope.organizationId }, "customers.write");
    expect(f.services.tenant.assertBranchAccess).toHaveBeenCalledWith({ userId: scope.userId, organizationId: scope.organizationId }, scope.branchId);
    expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("rejects missing details, numeric phone numbers and model-supplied scope", async () => {
    const f = setup();
    for (const input of [{ ...details, phone: "" }, { ...details, phone: 3001234567 }, { ...details, organizationId: "foreign-org" }]) {
      await expect(f.tools.execute("prepare_customer_create", input, scope)).rejects.toMatchObject({ code: "INVALID_COPILOT_TOOL_INPUT" });
    }
    expect(f.createMasterDataDraft).not.toHaveBeenCalled();
  });
  it("preserves branch and customer-write permission failures before preparation", async () => {
    const f = setup();
    vi.mocked(f.services.tenant.assertPermission).mockRejectedValue(new ApiError(403, "DENIED", "Denied"));
    await expect(f.tools.execute("prepare_customer_create", details, scope)).rejects.toMatchObject({ status: 403 });
    expect(f.createMasterDataDraft).not.toHaveBeenCalled();
  });
  it("does not classify a subsequent rate question as a customer request", async () => {
    const f = setup(); f.script(final("Need details"), final("No verified rate"));
    const first = await f.agent.run({ message: "Add new customer Saleem" }, scope);
    const second = await f.agent.run({ message: "PIPE 25MM KA RATE KIA HY", conversationToken: first.conversationToken, conversationId: first.conversationId }, scope);
    expect(second).not.toHaveProperty("preparation");
    expect(f.createMasterDataDraft).not.toHaveBeenCalled();
  });
});
