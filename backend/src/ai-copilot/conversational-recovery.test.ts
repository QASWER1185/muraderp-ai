import {describe,it,expect,vi} from "vitest";
import {munshiErrorMessage} from "./conversationalMunshi.js";
import {UnifiedCopilotAgent} from "./agent/agent.js";
import {newBusinessState,writeBusinessState,readBusinessState} from "./agent/business-state.js";
import {confirmConversationAction} from "./tools/confirmation.js";
import {ApiError} from "../errors/api-error.js";
import {CustomerMemoryStore} from "./customerMemoryStore.js";
import {CopilotRuntime} from "./copilot.runtime.js";
import {ErpToolRegistry} from "./agent/erp-tools.js";

const scope={userId:"a3000000-0000-4000-8000-000000000001",organizationId:"a3000000-0000-4000-8000-000000000002",branchId:"a3000000-0000-4000-8000-000000000003"};
describe("shared conversational recovery",()=>{
  it("reads full pending source rows under owner scope without exposing stale rates",async()=>{
    const eq=vi.fn();const auth=vi.fn();const query:any={select:()=>query,eq:(...args:any[])=>{eq(...args);return query;},maybeSingle:async()=>({data:{status:"DRAFT",action_plan:{branchId:scope.branchId,unifiedAction:{tool:"erp_create_estimate",input:{customerName:"خادم حسین پلمبر",items:[{name:"ململ",qty:4,unit:"gaz"}]},data:{secretCost:100}}}},error:null})};
    const runtime=new CopilotRuntime({} as any,{database:()=>({from:()=>query}),authorization:{assertPermission:auth},branchAccess:{assertBranchAccess:vi.fn()}} as any);
    const result=await runtime.inspectUnifiedDraft("original-preview",scope);
    expect(result.items).toEqual([{lineNumber:1,name:"ململ",qty:4,unit:"gaz"}]);expect(result).not.toHaveProperty("data");
    expect(eq.mock.calls).toEqual(expect.arrayContaining([["organization_id",scope.organizationId],["user_id",scope.userId]]));expect(auth).toHaveBeenCalledWith(scope.userId,scope.organizationId,"sales.create");
    await expect(runtime.inspectUnifiedDraft("original-preview",{...scope,branchId:"another"})).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
  });
  it("continues an implicit draft correction with inspect and amendment tools",async()=>{
    const state=newBusinessState(scope);state.workingActionId="a3000000-0000-4000-8000-000000000009";state.workingActionTool="erp_create_estimate";
    const model={respond:vi.fn().mockResolvedValueOnce({output:[],text:"No catalog match"}).mockResolvedValueOnce({output:[{type:"function_call",name:"erp_amend_estimate",call_id:"edit",arguments:"{}"}],text:""})};
    const executor={definitions:()=>["inspect_pending_action","search_products","erp_amend_estimate"].map(name=>({name})),execute:vi.fn(async()=>({review:{requiresConfirmation:false,preview:{summary:"Corrected pending draft"}}}))};
    const result=await new UnifiedCopilotAgent(model,executor).run({message:"اسی ڈرافٹ کی اصلاح کریں، ململ 4 گز شامل کریں",conversationToken:writeBusinessState(state)},scope);
    expect(result.answer).toBe("Corrected pending draft");expect(model.respond.mock.calls[0]?.[1]).toEqual([{name:"inspect_pending_action"},{name:"erp_amend_estimate"}]);
  });
  it("retains the customer before a provider failure and never treats a correction's جی as a new name",async()=>{
    const model={respond:vi.fn(async()=>{throw new ApiError(502,"AI_PROVIDER_ERROR","Provider failed");})};
    const first=await new UnifiedCopilotAgent(model,{definitions:()=>[],execute:vi.fn()}).run({message:"خادم حسین پلمبر کے لیے دو پائپ کا ایسٹیمیٹ بناؤ"},scope);
    const state=readBusinessState(first.conversationToken,scope);
    expect(state.estimateCustomerChoice?.name).toBe("خادم حسین پلمبر");
    const prepare=vi.fn(async(..._args:any[])=>({draftId:"preview"}));
    const tools=new ErpToolRegistry({tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},runtime:{createUnifiedDraft:prepare}} as any);
    await tools.execute("erp_create_estimate",{customerName:"جی",items:[{productId:11,qty:2}]},scope,state,"جی، اسی ایسٹیمیٹ میں پائپ پر 50 اور فٹنگ پر 52 فیصد لیس کرو");
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({customerName:"خادم حسین پلمبر"});
  });
  it("retains the owner's complete customer name and strips an inferred address",async()=>{
    const prepare=vi.fn(async(..._args:any[])=>({draftId:"preview"}));
    const tools=new ErpToolRegistry({tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},runtime:{createUnifiedDraft:prepare}} as any);
    const state=newBusinessState(scope);
    await tools.execute("erp_create_estimate",{customerName:"خادم حسین",customerAddress:"لاہور",items:[{productId:11,qty:2}]},scope,state,"خادم حسین پلمبر کے لیے دو پائپ کا ایسٹیمیٹ بناؤ");
    expect(prepare.mock.calls[0]?.[1]).toMatchObject({customerName:"خادم حسین پلمبر"});
    expect(prepare.mock.calls[0]?.[1]).not.toHaveProperty("customerAddress");
    expect(state.estimateCustomerChoice).toEqual({name:"خادم حسین پلمبر"});
  });
  it("does not complete an estimate correction with a standalone price read",async()=>{
    const rateCall={type:"function_call",call_id:"rate",name:"erp_get_product_sale_rate",arguments:"{}"};
    const prepareCall={type:"function_call",call_id:"preview",name:"erp_create_estimate",arguments:"{}"};
    const model={respond:vi.fn().mockResolvedValueOnce({output:[rateCall],text:""}).mockResolvedValueOnce({output:[],text:"PKR 100"}).mockResolvedValueOnce({output:[prepareCall],text:""})};
    const executor={definitions:()=>[],execute:vi.fn(async(name:string)=>name==="erp_get_product_sale_rate"?{resolution:"resolved",items:[],bestCandidate:{id:11,name:"Pipe",sku:"P",unit:"pcs"},verifiedSaleRate:true,analytics:true,answer:"PKR 100"}:{review:{draftId:"a3000000-0000-4000-8000-000000000009",tool:"erp_create_estimate",idempotencyKey:"new",requiresConfirmation:true,preview:{summary:"Updated complete estimate"}}})};
    const result=await new UnifiedCopilotAgent(model,executor).run({message:"اسی ایسٹیمیٹ میں پائپ پر 50 فیصد لگاؤ"},scope);
    expect(model.respond).toHaveBeenCalledTimes(3);expect(result.answer).toBe("Updated complete estimate");expect(result.requiresConfirmation).toBe(true);
  });
  it.each(["erp_create_invoice","erp_record_payment","erp_customer_return","erp_convert_estimate_to_invoice"])("revises %s with original inputs intact under actor/tenant/branch scope",async tool=>{
    const input={customerId:7,items:Array.from({length:100},(_,index)=>({productId:index+1,qty:2})),paidAmount:0};
    const eq=vi.fn();const query:any={select:()=>query,eq:(...args:any[])=>{eq(...args);return query;},maybeSingle:async()=>({data:{status:"DRAFT",action_plan:{branchId:scope.branchId,unifiedAction:{tool,input}}},error:null})};
    const runtime=new CopilotRuntime({} as any,{database:()=>({from:()=>query}),branchAccess:{assertBranchAccess:vi.fn()}} as any);
    const prepare=vi.spyOn(runtime,"createUnifiedDraft").mockResolvedValue({draftId:"new-preview"} as any);
    await runtime.reviseUnifiedDraft("original-preview",{paidAmount:80},scope);
    expect(prepare).toHaveBeenCalledWith(tool,{...input,paidAmount:80},scope,"text");
    expect(eq.mock.calls).toEqual(expect.arrayContaining([["organization_id",scope.organizationId],["user_id",scope.userId]]));
  });
  it.each(["CONFIRMED","EXECUTED","FAILED"])("refuses to revise a %s action",async status=>{
    const query:any={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{status,action_plan:{branchId:scope.branchId,unifiedAction:{tool:"erp_record_payment",input:{amount:1}}}},error:null})};
    const runtime=new CopilotRuntime({} as any,{database:()=>({from:()=>query}),branchAccess:{assertBranchAccess:vi.fn()}} as any);
    const prepare=vi.spyOn(runtime,"createUnifiedDraft");
    await expect(runtime.reviseUnifiedDraft("original-preview",{amount:2},scope)).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each(["erp_create_estimate","erp_create_invoice","erp_customer_return","prepare_supplier_bill","query_customer_ledger","erp_record_payment","query_inventory"])("retains specific recovery for %s and rejects model-invented success",async tool=>{
    let count=0;
    const model={respond:vi.fn(async()=>count++===0?{output:[{type:"function_call",call_id:"failed",name:tool,arguments:"{}"}],text:""}:{output:[],text:""})};
    const executor={definitions:()=>[],execute:vi.fn(async()=>{throw new ApiError(502,"ERP_READ_FAILED","SQL secret must not appear");})};
    const state=newBusinessState(scope);state.workingActionId="a3000000-0000-4000-8000-000000000009";
    const result=await new UnifiedCopilotAgent(model,executor).run({message:"تفصیل دکھائیں",conversationToken:writeBusinessState(state)},scope);
    expect(result.answer).toContain("اصل ریکارڈ");expect(result.answer).not.toContain("SQL secret");
    expect(result.requiresConfirmation).toBe(false);
    expect(readBusinessState(result.conversationToken,scope).workingActionId).toBe(state.workingActionId);
  });
  it("preserves a failed confirmation's exact approval identity without claiming no posting occurred",async()=>{
    const state=newBusinessState(scope);state.pendingAction={draftId:"draft",idempotencyKey:"same-key",summary:"receipt",expires:Date.now()+60000};
    const execute=vi.fn(async()=>{throw new Error("upstream secret");});
    const result=await confirmConversationAction(state,scope,execute);
    expect(result.status).toBe("clarification");expect(result.answer).not.toContain("upstream secret");
    expect(readBusinessState(result.conversationToken,scope).pendingAction?.idempotencyKey).toBe("same-key");
    expect(result.answer).toContain("دہرا اندراج");
  });
  it("trims dialogue to keep operational references within the signed token budget",()=>{
    const state=newBusinessState(scope);state.workingActionId="a3000000-0000-4000-8000-000000000009";
    state.recentTurns=Array.from({length:3},()=>({user:"جناب".repeat(87),assistant:"تفصیل".repeat(70)}));
    const token=writeBusinessState(state);
    expect(token.length).toBeLessThanOrEqual(9000);expect(readBusinessState(token,scope).workingActionId).toBe(state.workingActionId);
  });
  it("replaces banned authored messages and never exposes unexpected database text",()=>{
    expect(munshiErrorMessage("UNKNOWN","اس مرحلے کی تصدیق نہیں ہو سکی")).not.toContain("اس مرحلے کی تصدیق نہیں ہو سکی");
    expect(munshiErrorMessage("23502","password=secret")).not.toContain("password");
  });
  it("asks for the source invoice when historical net return rates differ",async()=>{
    const query:any={};for(const key of ["select","eq","order","limit","range"])query[key]=()=>query;
    query.then=(resolve:any)=>Promise.resolve({data:[{document_id:1,document_number:"INV-1",invoice_date:"2026-10-01",net_unit_price:240,unit:"pcs",currency_code:"PKR"},{document_id:2,document_number:"INV-2",invoice_date:"2026-10-02",net_unit_price:250,unit:"pcs",currency_code:"PKR"}],error:null}).then(resolve);
    const memory=new CustomerMemoryStore(()=>({from:()=>query}) as any);
    await expect(memory.latestSale(scope,7,11)).rejects.toMatchObject({code:"RETURN_INVOICE_CHOICE_REQUIRED",message:expect.stringContaining("240")});
  });
});
