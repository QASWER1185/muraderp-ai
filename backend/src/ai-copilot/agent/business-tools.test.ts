import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../errors/api-error.js";
import { resolveCandidates } from "../../services/entity-search.service.js";
import { businessAnswer } from "./business-answer.js";
import type { BusinessFact } from "./business-tools.js";
import { businessFixture, scope, pipe, dura, third, customerPayment, vendorPayment, customer, vendor } from "./business.test-fixtures.js";

describe("Part 3 authoritative business tools", () => {
  it("reads full ledger balances independently of bounded transaction history and retains source/journal references", async () => {
    const f = businessFixture();
    const result = await f.tools.execute("query_customer_ledger", { limit: 1, before_id: 10 }, scope, f.state) as BusinessFact;
    expect(result).toMatchObject({ customer, ledgerScope: "BRANCH", balances: [{ outstanding: 800 }], transactions: [{ referenceId: 701, journals: [{ status: "POSTED" }] }], latestPayment: { amount: 200 }, nextCursor: 2 });
    expect(f.business.repository.customerLedger).toHaveBeenCalledWith(scope, customer.id, 1, 10);
    expect(businessAnswer([result],"قاسم کا بقایا")).toContain("بقایا 800");
  });
  it("distinguishes a known zero ledger balance from an empty ledger with no currency", async () => {
    const f = businessFixture();
    vi.mocked(f.business.repository.customerLedger).mockResolvedValue({ balances: [{ currency_code: "PKR", debit: 200, credit: 200, outstanding: 0 }], transactions: [], latestPayment: null, nextCursor: null });
    expect(await f.tools.execute("query_customer_ledger", {}, scope, f.state)).toMatchObject({ status: "available", balances: [{ outstanding: 0 }] });
    vi.mocked(f.business.repository.customerLedger).mockResolvedValue({ balances: [], transactions: [], latestPayment: null, nextCursor: null });
    const empty = await f.tools.execute("query_customer_ledger", {}, scope, f.state) as BusinessFact;
    expect(empty).toMatchObject({ status: "empty", balances: [] });
    expect(businessAnswer([empty],"ledger")).toContain("currency balance is unavailable");
  });
  it("uses indexed customer queries and revalidates a resolved party", async () => {
    const f = businessFixture(); delete f.state.customer;
    await f.tools.execute("query_customer_ledger", { query: "قاسم صاحب" }, scope, f.state);
    expect(f.services.search.searchCustomers).toHaveBeenCalledWith("قاسم صاحب",5,scope);
    expect(f.services.erp.getCustomer).toHaveBeenCalledWith(customer.id, scope.organizationId);
    expect(f.state.customer).toEqual(customer);
  });
  it.each(["missing", "ambiguous"])("does not read a %s customer ledger", async mode => {
    const f = businessFixture();
    if (mode === "missing") vi.mocked(f.services.erp.getCustomer).mockResolvedValue(null);
    else f.state.customerAmbiguous = true;
    await expect(f.tools.execute("query_customer_ledger",{},scope,f.state)).rejects.toBeInstanceOf(ApiError);
    expect(f.business.repository.customerLedger).not.toHaveBeenCalled();
  });
  it("requires clarification for an ambiguous customer query without reading a balance", async () => {
    const f = businessFixture();
    vi.mocked(f.services.search.searchCustomers).mockResolvedValue(resolveCandidates([{ id: 19, name: "Qasim DHA", city:"DHA",confidence:1,match_kind:"exact_name" },{id:20,name:"Qasim Lake City",city:"Lake City",confidence:1,match_kind:"exact_name"}],5));
    await expect(f.tools.execute("query_customer_ledger",{query:"Qasim"},scope,f.state)).rejects.toMatchObject({code:"BUSINESS_CONTEXT_REQUIRED"});
    expect(f.business.repository.customerLedger).not.toHaveBeenCalled();
  });
  it("keeps organization inventory and branch movement scope explicit and does not derive stock from movements", async () => {
    const f = businessFixture();
    const result = await f.tools.execute("query_inventory",{warehouse_id:1,limit:3,cursor:2,movement_cursor:7},scope,f.state);
    expect(result).toMatchObject({ status:"available", branchStatus:"unsupported",branchOnHand:null,totalQuantity:null,balances:[{quantity:100,unit:"MTR"}],movementScope:"BRANCH" });
    expect(f.business.erp.listInventory).toHaveBeenCalledWith({warehouse_id:1,product_id:pipe.id,limit:3,cursor:2},scope.organizationId);
    expect(f.business.erp.listStockMovements).toHaveBeenCalledWith({warehouse_id:1,product_id:pipe.id,limit:3,cursor:7},scope.organizationId,scope.branchId);
  });
  it("reports branch on-hand as unsupported without exposing organization balance as branch stock", async () => {
    const f=businessFixture();
    expect(await f.tools.execute("query_inventory",{balance_scope:"branch"},scope,f.state)).toMatchObject({status:"unsupported",balances:[],totalQuantity:null,branchOnHand:null});
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it.each([0,null])("distinguishes stock %s from unavailable stock",async qty=>{
    const f=businessFixture();
    vi.mocked(f.business.erp.listInventory).mockResolvedValue({data:qty===null?[]:[{id:1,warehouse_id:1,quantity:qty}] as any,next_cursor:null});
    expect(await f.tools.execute("query_inventory",{},scope,f.state)).toMatchObject(qty===null?{status:"unavailable",totalQuantity:null}:{status:"available",totalQuantity:0});
  });
  it("does not report a stock page as a complete total",async()=>{
    const f=businessFixture();vi.mocked(f.business.erp.listInventory).mockResolvedValue({data:[{id:1,warehouse_id:1,quantity:10}] as any,next_cursor:1});
    expect(await f.tools.execute("query_inventory",{},scope,f.state)).toMatchObject({totalQuantity:null,nextCursor:1});
  });
  it.each(["missing product","missing warehouse","ambiguous product"])("blocks %s before stock reads",async mode=>{
    const f=businessFixture();
    if(mode==="missing product")vi.mocked(f.services.erp.getProduct).mockResolvedValue(null);
    if(mode==="ambiguous product")f.state.productContext!.ambiguous=true;
    await expect(f.tools.execute("query_inventory",mode==="missing warehouse"?{warehouse_id:999}:{},scope,f.state)).rejects.toBeInstanceOf(ApiError);
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it("reuses signed product context without loading a catalog or repeating entity search",async()=>{
    const f=businessFixture();await f.tools.execute("query_inventory",{},scope,f.state);
    expect(f.services.search.searchProducts).not.toHaveBeenCalled();expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
  });
  it("calculates profit with the existing profit service and applies quantity/discount deterministically",async()=>{
    const f=businessFixture();
    expect(await f.tools.execute("calculate_margin",{quantity:10},scope,f.state)).toMatchObject({revenue:5000,estimatedCost:3000,grossProfit:2000,marginPercent:40,costBasis:"ACTIVE_PURCHASE_RATE_ESTIMATE"});
    const discounted=await f.tools.execute("calculate_margin",{discount_percent:10},scope,f.state) as BusinessFact;
    expect(discounted).toMatchObject({quantity:10,revenue:4500,discountAmount:500,estimatedCost:3000,grossProfit:1500});
    expect(discounted.marginPercent).toBeCloseTo(100/3,10);
    expect(f.services.pricing.resolvePrice).toHaveBeenCalledWith(expect.objectContaining({price_type:"PURCHASE",organization_id:scope.organizationId,product_id:pipe.id}));
  });
  it("keeps missing purchase cost null rather than substituting zero or sale/master price",async()=>{
    const f=businessFixture();const resolve=vi.mocked(f.services.pricing.resolvePrice).getMockImplementation()!;
    vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>input.price_type==="PURCHASE"?null:resolve(input));
    const result=await f.tools.execute("calculate_margin",{},scope,f.state) as BusinessFact;
    expect(result).toMatchObject({status:"unavailable",purchaseCost:null,estimatedCost:null,grossProfit:null,marginPercent:null});
    expect(businessAnswer([result],"margin")).toContain("Authoritative purchase cost unavailable");
  });
  it("reports ambiguous purchase rate books without making a cost choice",async()=>{
    const f=businessFixture();const resolve=vi.mocked(f.services.pricing.resolvePrice).getMockImplementation()!;
    vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>{if(input.price_type==="PURCHASE")throw new Error("Ambiguous pricing: multiple active rate lists match the winning scope");return resolve(input);});
    expect(await f.tools.execute("calculate_margin",{},scope,f.state)).toMatchObject({costStatus:"ambiguous",grossProfit:null,marginPercent:null});
  });
  it.each(["zero cost","zero sale","full discount","loss","break even"])("handles %s without losing known zero values",async mode=>{
    const f=businessFixture();
    if(mode==="zero cost")f.cost.set(pipe.id,0);
    if(mode==="zero sale")f.sale.set(pipe.id,0);
    if(mode==="loss")f.cost.set(pipe.id,600);
    if(mode==="break even")f.cost.set(pipe.id,500);
    const result=await f.tools.execute("calculate_margin",mode==="full discount"?{discount_percent:100}:{},scope,f.state);
    expect(result).toMatchObject(mode==="zero cost"?{grossProfit:500,marginPercent:100}:mode==="zero sale"||mode==="full discount"?{revenue:0,grossProfit:-300,marginPercent:null}:mode==="loss"?{grossProfit:-100,marginPercent:-20}:{grossProfit:0,marginPercent:0});
  });
  it.each(["unit","currency"])("refuses margin when purchase %s is incompatible",async field=>{
    const f=businessFixture();const resolve=vi.mocked(f.services.pricing.resolvePrice).getMockImplementation()!;
    vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>{const result=await resolve(input);return input.price_type==="PURCHASE"?{...result!,...(field==="unit"?{unit:"PCS"}:{currency_code:"USD"})}:result;});
    expect(await f.tools.execute("calculate_margin",{},scope,f.state)).toMatchObject({status:"unavailable",grossProfit:null,marginPercent:null,reason:expect.stringContaining("mismatch")});
  });
  it("does not price with an ambiguous retained customer or another customer's rate list",async()=>{
    const f=businessFixture();f.state.customerAmbiguous=true;
    await expect(f.tools.execute("calculate_margin",{},scope,f.state)).rejects.toMatchObject({code:"BUSINESS_CONTEXT_REQUIRED"});
    f.state.customerAmbiguous=false;f.state.rateListId=999;
    await expect(f.tools.execute("calculate_margin",{},scope,f.state)).rejects.toMatchObject({status:403});
    expect(f.services.pricing.resolvePrice).not.toHaveBeenCalled();
  });
  it.each(["sale_price","purchase_cost","profit","margin","stock"] as const)("compares authoritative %s for two brand-qualified products and refreshes follow-ups",async metric=>{
    const f=businessFixture();
    const first=await f.tools.execute("compare_products",{queries:["Popular 25mm pipe","Dura 25mm pipe"],metric},scope,f.state);
    expect(first).toMatchObject({status:"available",winners:[{id:metric==="sale_price"?dura.id:pipe.id}]});
    expect(f.services.search.searchProducts).toHaveBeenCalledTimes(2);
    f.sale.set(dura.id,350);
    const follow=await f.tools.execute("compare_products",{metric:"sale_price"},scope,f.state);
    expect(follow).toMatchObject({values:[500,350],winners:[{id:dura.id}]});
    expect(f.services.search.searchProducts).toHaveBeenCalledTimes(2);
  });
  it("supports more than two products and ties",async()=>{
    const f=businessFixture();f.sale.set(third.id,450);
    expect(await f.tools.execute("compare_products",{queries:["Popular pipe","Dura pipe","Third pipe"],metric:"sale_price"},scope,f.state)).toMatchObject({winners:[{id:dura.id},{id:third.id}],values:[500,450,450]});
  });
  it("retains comparison quantity and discount choices on metric follow-ups",async()=>{
    const f=businessFixture();
    await f.tools.execute("compare_products",{queries:["Popular pipe","Dura pipe"],metric:"profit",quantity:10,discount_percent:10},scope,f.state);
    expect(await f.tools.execute("compare_products",{metric:"margin"},scope,f.state)).toMatchObject({quantity:10,discountPercent:10,rows:[{quantity:10,discountPercent:10},{quantity:10,discountPercent:10}]});
    expect(f.state.comparisonAnalysis).toEqual({quantity:10,discountPercent:10});
  });
  it.each(["ambiguous","duplicate","mixed units","missing cost","missing stock","paged stock"])("does not choose a comparison winner with %s",async mode=>{
    const f=businessFixture();
    const queries=mode==="duplicate"?["Popular pipe","Popular pipe"]:mode==="mixed units"?["Popular pipe","Popular elbow"]:["Popular pipe","Dura pipe"];
    if(mode==="ambiguous")vi.mocked(f.services.search.searchProducts).mockResolvedValue(resolveCandidates([{...pipe,confidence:1,match_kind:"exact_name",category:"Pipe",brandName:"Popular"},{...dura,confidence:1,match_kind:"exact_name",category:"Pipe",brandName:"Dura"}],5));
    if(mode==="missing cost")vi.mocked(f.services.pricing.resolvePrice).mockResolvedValue(null);
    if(mode==="missing stock"||mode==="paged stock")vi.mocked(f.business.erp.listInventory).mockResolvedValue({data:mode==="missing stock"?[]:[{id:1,quantity:5,warehouse_id:1}] as any,next_cursor:mode==="paged stock"?1:null});
    const task=f.tools.execute("compare_products",{queries,metric:mode.includes("stock")?"stock":mode==="missing cost"?"margin":"sale_price"},scope,f.state);
    if(mode==="ambiguous"||mode==="duplicate")await expect(task).rejects.toMatchObject({code:"BUSINESS_CONTEXT_REQUIRED"});
    else expect(await task).toMatchObject({status:"unavailable",winners:[]});
  });
  it("requires compatible purchase cost units and currencies in cost comparisons",async()=>{
    const f=businessFixture();const resolve=vi.mocked(f.services.pricing.resolvePrice).getMockImplementation()!;
    vi.mocked(f.services.pricing.resolvePrice).mockImplementation(async input=>{const result=await resolve(input);return input.price_type==="PURCHASE"&&input.product_id===dura.id?{...result!,unit:"PCS"}:result;});
    expect(await f.tools.execute("compare_products",{queries:["Popular pipe","Dura pipe"],metric:"purchase_cost"},scope,f.state)).toMatchObject({status:"unavailable",winners:[]});
  });
  it.each(["customer","vendor"] as const)("lists scoped %s documents then prepares only a signed payment review",async kind=>{
    const f=businessFixture();
    await f.tools.execute("list_payment_documents",{party_type:kind,limit:2},scope,f.state);
    const result=await f.tools.execute(kind==="customer"?"prepare_customer_payment":"prepare_vendor_payment",kind==="customer"?customerPayment:vendorPayment,scope,f.state);
    expect(result).toMatchObject({requiresConfirmation:true,executed:false,intent:kind+"_payment"});
    expect(f.state.paymentPreparation?.payment.amount).toBe(200);
    expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it.each(["customer","vendor"] as const)("validates %s ownership, allocation party and remaining balances",async kind=>{
    const f=businessFixture();const payment=kind==="customer"?customerPayment:vendorPayment;
    const tool=kind==="customer"?"prepare_customer_payment":"prepare_vendor_payment";
    await expect(f.tools.execute(tool,{...payment,amount:1001,allocations:kind==="customer"?[{invoice_id:501,amount:1001}]:[{purchase_id:601,amount:1001}]},scope,f.state)).rejects.toMatchObject({code:"PAYMENT_ALLOCATION_INVALID"});
    await expect(f.tools.execute(tool,{...payment,...(kind==="customer"?{customer_id:999}:{vendor_id:999})},scope,f.state)).rejects.toMatchObject({code:"BUSINESS_CONTEXT_REQUIRED"});
    expect(f.state.paymentPreparation).toBeUndefined();
  });
  it.each([{amount:0},{amount:-1},{amount:200.001},{customer_id:"19"},{customer_id:1.5},{payment_date:"2026-02-30"},{payment_method:"BITCOIN"},{account_id:"forged"},{organization_id:"forged"},{currency_code:"USD"},{allocations:[{invoice_id:999,amount:200}]},{allocations:[{invoice_id:501,amount:100},{invoice_id:501,amount:100}]},{allocations:[{invoice_id:501,amount:50}]}])("rejects invalid payment choices %j",async patch=>{
    const f=businessFixture();await expect(f.tools.execute("prepare_customer_payment",{...customerPayment,...patch},scope,f.state)).rejects.toBeInstanceOf(ApiError);
    expect(f.state.paymentPreparation).toBeUndefined();expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("does not guess required payment fields or unsupported vendor currency",async()=>{
    const f=businessFixture();
    await expect(f.tools.execute("prepare_customer_payment",{customer_id:19,amount:20000},scope,f.state)).rejects.toMatchObject({code:"INVALID_COPILOT_TOOL_INPUT"});
    await expect(f.tools.execute("prepare_vendor_payment",{...vendorPayment,currency_code:"PKR"},scope,f.state)).rejects.toMatchObject({code:"INVALID_COPILOT_TOOL_INPUT"});
  });
  it("uses bounded indexed vendor resolution instead of a catalog",async()=>{
    const f=businessFixture();await f.tools.execute("lookup_vendors",{query:"Popular supplier",limit:1},scope,f.state);
    expect(f.state.vendor).toEqual(vendor);expect(f.business.repository.searchVendors).toHaveBeenCalledWith(scope,"Popular supplier",1);expect(f.services.catalog.getCatalog).not.toHaveBeenCalled();
    vi.mocked(f.business.repository.searchVendors).mockResolvedValue(resolveCandidates([{...vendor,confidence:1,match_kind:"exact_name"},{id:9,name:"Other supplier",confidence:1,match_kind:"exact_name"}],5));
    await f.tools.execute("lookup_vendors",{query:"supplier"},scope,f.state);
    expect(f.state.vendorAmbiguous).toBe(true);expect(f.state.vendor).toBeUndefined();
    await expect(f.tools.execute("prepare_vendor_payment",vendorPayment,scope,f.state)).rejects.toMatchObject({code:"BUSINESS_CONTEXT_REQUIRED"});
  });
  it.each(["query_customer_ledger","query_inventory","calculate_margin","compare_products","list_payment_documents","prepare_customer_payment","prepare_vendor_payment","lookup_vendors"])("enforces revoked permissions and exact branch access for %s before domain reads",async name=>{
    const f=businessFixture();f.gateway.hasPermission.mockResolvedValue(false);
    await expect(f.tools.execute(name,{},scope,f.state)).rejects.toMatchObject({status:403});
    f.gateway.hasPermission.mockResolvedValue(true);f.gateway.hasBranchAccess.mockResolvedValue(false);
    await expect(f.tools.execute(name,{},scope,f.state)).rejects.toMatchObject({status:403});
    expect(f.services.erp.getProduct).not.toHaveBeenCalled();expect(f.business.repository.customerLedger).not.toHaveBeenCalled();expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it.each(["userId","organizationId","branchId"] as const)("rejects cross-%s state and current authorization even without relying on model instructions",async field=>{
    const f=businessFixture();const other={...scope,[field]:"44444444-4444-4444-8444-444444444444"};
    await expect(f.tools.execute("query_inventory",{},other,f.state)).rejects.toMatchObject({status:403});
    await expect(f.tools.execute("query_inventory",{},other,{...f.state,...other})).rejects.toMatchObject({status:403});
    expect(f.business.erp.listInventory).not.toHaveBeenCalled();
  });
  it.each(["unit_price","cost","balance","stock","total","branch_id","permissions"])("rejects client/model injected %s authority",async field=>{
    const f=businessFixture();await expect(f.tools.execute("calculate_margin",{[field]:1},scope,f.state)).rejects.toMatchObject({code:"INVALID_COPILOT_TOOL_INPUT"});
    expect(f.services.pricing.resolvePrice).not.toHaveBeenCalled();
  });
  it("denies forged scoped entity IDs and unknown tool invocation",async()=>{
    const f=businessFixture();delete f.state.productContext;delete f.state.customer;delete f.state.vendor;
    for(const [name,args] of [["query_inventory",{product_id:999}],["query_customer_ledger",{customer_id:999}],["prepare_vendor_payment",{...vendorPayment,vendor_id:999}],["post_journal",{}]] as const){
      await expect(f.tools.execute(name,args,scope,f.state)).rejects.toBeInstanceOf(ApiError);
    }
    expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("checks cancellation after a nested read and does not commit transient payment state",async()=>{
    const f=businessFixture();const controller=new AbortController();
    vi.mocked(f.business.customers.listReceivables).mockImplementation(async()=>{controller.abort();return {data:[],next_cursor:null};});
    await expect(f.tools.execute("prepare_customer_payment",customerPayment,scope,f.state,undefined,controller.signal)).rejects.toBeDefined();
    expect(f.state.paymentPreparation).toBeUndefined();
  });
});
