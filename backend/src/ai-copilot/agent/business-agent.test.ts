import { describe, expect, it, vi } from "vitest";
import { resolveCandidates } from "../../services/entity-search.service.js";
import { UnifiedCopilotAgent } from "./agent.js";
import { newBusinessState, readBusinessState, touchDraft, writeBusinessState } from "./business-state.js";
import { businessFixture, call, final, scope, pipe, dura, customer, customerPayment } from "./business.test-fixtures.js";

describe("Part 3 unified sequential business reasoning",()=>{
  it.each([
    {message:"Popular 25mm pipe ka stock aur rate batao",names:["search_products","lookup_current_sale_rate","query_inventory"]},
    {message:"Popular pipe rate and margin",names:["search_products","lookup_current_sale_rate","calculate_margin"]},
    {message:"Popular 25mm pipe کا stock، current sale rate اور میری margin بتاؤ",names:["search_products","lookup_current_sale_rate","query_inventory","calculate_margin"]},
  ])("combines $message with fresh authoritative tool facts",async({message,names})=>{
    const f=businessFixture();
    f.script(...names.map(name=>call(name,name==="search_products"?{query:"Popular 25mm pipe"}:name==="lookup_current_sale_rate"?{product_id:pipe.id}:{})),final("The balance and profit are 999999999"));
    const result=await f.core.run({message},scope);
    expect(result.status).toBe("completed");expect(result.toolNames).toEqual(names);
    expect(result.answer).not.toContain("999999999");expect(result.businessFacts).toHaveLength(names.length-1);
    expect(result.answer).toContain("500");
    if(names.includes("calculate_margin"))expect(result.answer).toContain("40");
    if(names.includes("query_inventory"))expect(result.answer).toContain("100 MTR");
    expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
  });
  it("retains a product across Urdu stock, margin and discount follow-ups without repeating search or storing prices",async()=>{
    const f=businessFixture();f.script(call("search_products",{query:"Popular 25mm pipe"}),final("product"));
    let result=await f.core.run({message:"Popular 25mm pipe دکھاؤ"},scope);
    const follow=async(message:string,...steps:ReturnType<typeof call>[])=>{
      f.script(...steps,final("Invented 999999"));
      result=await f.core.run({message,conversationToken:result.conversationToken,conversationId:result.conversationId},scope);
      expect(result.status).toBe("completed");expect(result.answer).not.toContain("999999");
    };
    await follow("اس کا stock بتاؤ",call("query_inventory"));
    expect(result.answer).toContain("100 MTR");
    await follow("اور margin؟",call("calculate_margin",{quantity:10}));
    expect(result.answer).toContain("2000");
    await follow("اگر 10 فیصد discount دوں تو؟",call("calculate_margin",{discount_percent:10}));
    expect(result.answer).toContain("1500");
    const state=readBusinessState(result.conversationToken,scope,result.conversationId);
    expect(state.analysis).toEqual({productId:pipe.id,quantity:10,discountPercent:10});
    expect(state).not.toHaveProperty("purchaseCost");expect(state).not.toHaveProperty("saleRate");
    expect(f.services.search.searchProducts).toHaveBeenCalledOnce();
  });
  it("remembers two verified comparison references for 'both' and reloads prices",async()=>{
    const f=businessFixture();f.script(call("compare_products",{queries:["Popular 25mm pipe","Dura 25mm pipe"],metric:"sale_price"}),final("invented winner"));
    const first=await f.core.run({message:"Popular اور Dura 25mm compare کرو"},scope);
    expect(first.businessFacts?.[0]).toMatchObject({winners:[{id:dura.id}]});
    f.sale.set(dura.id,550);
    f.script(call("compare_products",{metric:"margin"}),final("margin is 999"));
    const follow=await f.core.run({message:"دونوں میں margin کس کی زیادہ ہے؟",conversationToken:first.conversationToken,conversationId:first.conversationId},scope);
    expect(follow.businessFacts?.[0]).toMatchObject({winners:[{id:dura.id}]});
    expect(readBusinessState(follow.conversationToken,scope).comparison?.map(ref=>ref.id)).toEqual([pipe.id,dura.id]);
    expect(f.services.search.searchProducts).toHaveBeenCalledTimes(2);
  });
  it("does not claim missing cost/stock values supplied by model final text",async()=>{
    const f=businessFixture();vi.mocked(f.business.erp.listInventory).mockResolvedValue({data:[],next_cursor:null});
    const resolve=vi.mocked(f.services.pricing.resolvePrice).getMockImplementation()!;
    vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>input.price_type==="PURCHASE"?null:resolve(input));
    f.script(call("search_products",{query:"Popular pipe"}),call("query_inventory"),call("calculate_margin"),final("Stock 9000; margin 90%"));
    const result=await f.core.run({message:"stock and margin"},scope);
    expect(result.answer).toContain("unavailable");expect(result.answer).not.toContain("9000");expect(result.answer).not.toContain("90%");
  });
  it("returns safe partial results when a requested domain read fails",async()=>{
    const f=businessFixture();vi.mocked(f.business.repository.customerLedger).mockRejectedValue(new Error("db unavailable"));
    f.script(call("lookup_customers",{query:"Qasim"}),call("query_customer_ledger"),final("Outstanding zero"));
    const result=await f.core.run({message:"ledger"},scope);
    expect(result.answer).toContain("authoritative result unavailable");expect(result.answer).not.toContain("Outstanding zero");
  });
  it("invalidates ambiguous product context and refuses a follow-up without selecting a candidate",async()=>{
    const f=businessFixture();vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([{...pipe,confidence:1,match_kind:"exact_name",category:"Pipe",brandName:"Popular"},{...dura,confidence:1,match_kind:"exact_name",category:"Pipe",brandName:"Dura"}],5));
    f.script(call("compare_products",{queries:["pipe","Dura pipe"],metric:"margin"}));
    const first=await f.core.run({message:"compare pipe",conversationToken:writeBusinessState(f.state)},scope);
    expect(first.status).toBe("clarification");expect(readBusinessState(first.conversationToken,scope).comparison).toBeUndefined();
    f.script(call("query_inventory"));
    const follow=await f.core.run({message:"اس کا stock",conversationToken:first.conversationToken},scope);
    expect(follow.status).toBe("clarification");expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it("requests clarification when comparison context is unavailable",async()=>{
    const f=businessFixture();f.script(call("compare_products",{metric:"stock"}));
    const result=await f.core.run({message:"dono mein stock?"},scope);
    expect(result.status).toBe("clarification");expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it.each(["product","customer","vendor"])("invalidates a previous %s after a failed new selection before a pronoun follow-up",async kind=>{
    const f=businessFixture();
    const firstTool=kind==="product"?"query_inventory":kind==="customer"?"query_customer_ledger":"lookup_vendors";
    const nextTool=kind==="product"?"query_inventory":"list_payment_documents";
    const search=kind==="product"?f.services.search.searchProducts:kind==="customer"?f.services.search.searchCustomers:f.business.repository.searchVendors;
    vi.mocked(search).mockRejectedValue(new Error("Search unavailable"));
    f.script(call(firstTool,{query:"Different entity"}),final("invented"));
    const first=await f.core.run({message:"new entity",conversationToken:writeBusinessState(f.state)},scope);
    const state=readBusinessState(first.conversationToken,scope);
    expect(kind==="product"?state.productContext:kind==="customer"?state.customer:state.vendor).toBeUndefined();
    f.script(call(nextTool,kind==="product"?{}:{party_type:kind}));
    const follow=await f.core.run({message:"this one",conversationToken:first.conversationToken},scope);
    expect(follow.status).toBe("clarification");
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
    expect(f.business.customers.listReceivables).not.toHaveBeenCalled();
    expect(f.business.vendors.listPayables).not.toHaveBeenCalled();
  });
  it("a ledger query updates the canonical retained customer and invalidates an estimate prepared for another customer",async()=>{
    const f=businessFixture();f.state.customer={id:20,name:"Other"};const draft=touchDraft(f.state);draft.preparedRevision=draft.revision;
    f.script(call("query_customer_ledger",{query:"Qasim"}),final("ledger"));
    const result=await f.core.run({message:"قاسم صاحب کا حساب",conversationToken:writeBusinessState(f.state)},scope);
    const state=readBusinessState(result.conversationToken,scope);
    expect(state.customer).toEqual(customer);expect(state.draft?.preparedRevision).toBeUndefined();expect(state.draft?.id).toBe(draft.id);
  });
  it("prepares only a signed receipt, requires confirmation, then clears review on a new turn",async()=>{
    const f=businessFixture();f.script(call("lookup_customers",{query:"Qasim"}),call("list_payment_documents",{party_type:"customer"}),call("prepare_customer_payment",customerPayment),final("paid"));
    const first=await f.core.run({message:"Qasim se 200 CASH receive karo invoice 501 pe 2026-10-05"},scope);
    expect(first.paymentPreparation).toMatchObject({intent:"customer_payment",payment:{amount:200}});expect(first.requiresConfirmation).toBe(true);
    expect(first.answer).toContain("Nothing executed");expect(f.erpWrite).not.toHaveBeenCalled();
    f.script(call("query_customer_ledger"),final("ledger"));
    const follow=await f.core.run({message:"ledger",conversationToken:first.conversationToken},scope);
    expect(follow.paymentPreparation).toBeUndefined();expect(follow.requiresConfirmation).toBe(false);
  });
  it.each(["userId","organizationId","branchId","expiry","forgery"])("fails closed for invalid %s context before model tools",async field=>{
    const f=businessFixture();const state=newBusinessState(scope);
    if(field==="expiry")state.expires=Date.now()-1;
    else if(field!=="forgery")(state as any)[field]="44444444-4444-4444-8444-444444444444";
    const token=writeBusinessState(state)+(field==="forgery"?"tampered":"");
    const result=await f.core.run({message:"stock",conversationToken:token},scope);
    expect(result.status).toBe("clarification");expect(f.respond).not.toHaveBeenCalled();
  });
  it("does not advance state after a nested business read exceeds the agent deadline",async()=>{
    const f=businessFixture();let release!:()=>void;
    vi.mocked(f.business.erp.listInventory).mockImplementation(async()=>{await new Promise<void>(resolve=>release=resolve);return {data:[],next_cursor:null};});
    f.script(call("query_inventory",{query:"Popular pipe"}));
    const core=new UnifiedCopilotAgent({respond:f.respond},f.tools,15);
    const result=await core.run({message:"stock"},scope);expect(result.status).toBe("timeout");
    release();await new Promise(resolve=>setTimeout(resolve,10));
    expect(f.business.erp.listStockMovements).not.toHaveBeenCalled();
    expect(readBusinessState(result.conversationToken,scope).productContext).toBeUndefined();
  });
});
