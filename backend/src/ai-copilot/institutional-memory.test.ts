import { describe, expect, it, vi } from "vitest";
import { CustomerMemoryStore, rememberedDiscount, type CommercialHistoryLine, type CustomerMemory } from "./customerMemoryStore.js";
import { SlipLearningStore } from "./slipLearningStore.js";
import { DefaultErpOperations, type OperationsDependencies } from "./tools/operations.js";
import { ERP_ACTION_SCHEMAS } from "./tools/registry.js";
import { ConversationalDraftService } from "./agent/draft-tools.js";
import { newBusinessState } from "./agent/business-state.js";
import { businessFixture, scope as businessScope, pipe } from "./agent/business.test-fixtures.js";
import { ApiError } from "../errors/api-error.js";

const scope={userId:"a3000000-0000-4000-8000-000000000001",organizationId:"a3000000-0000-4000-8000-000000000002",branchId:"a3000000-0000-4000-8000-000000000003"};
const sale:CommercialHistoryLine={customer_id:7,product_id:11,product_name:"Dura Max Medium Pipe",brand_id:5,brand_name:"Dura Max",category:"Pipes",unit:"pcs",quantity:10,unit_price:100,discount_percent:50,net_unit_price:50,invoice_date:"2026-10-18",document_id:1060,document_number:"INV-1060",document_type:"invoice",source_item_id:91,currency_code:"PKR"};
function dbFixture(rows:unknown[]=[]) {
  const query:any={};for(const method of ["select","eq","order","range","limit"])query[method]=vi.fn(()=>query);
  query.then=(resolve:any)=>Promise.resolve({data:rows,error:null}).then(resolve);
  const db={from:vi.fn(()=>query),rpc:vi.fn(async()=>({data:50,error:null}))};return {db,query};
}
async function profile() {return new CustomerMemoryStore(()=>dbFixture([sale]).db).recall(scope,7,"Faisal Butt");}
function operations(memory:CustomerMemory) {
  const f=dbFixture();
  const product={id:11,name:sale.product_name,brand_id:5,category:"Pipes",unit:"pcs"};
  const deps={database:()=>f.db,principal:"copilot-test",memory,
    erp:{getCustomer:vi.fn(async()=>({id:7,name:"Faisal Butt"})),getProduct:vi.fn(async()=>product),getWarehouse:vi.fn(async()=>({id:1})),listWarehouses:vi.fn(async()=>({data:[{id:1}],next_cursor:null}))},
    pricing:{resolvePrice:vi.fn(async()=>({unit_price:120,unit:"pcs",currency_code:"PKR",rate_list_id:1,rate_list_version_id:1}))},search:{searchProducts:vi.fn()},
    returns:{recordSalesReturn:vi.fn(async()=>({credit_note:{id:31}}))},
  } as unknown as OperationsDependencies;
  return {ops:new DefaultErpOperations(deps),deps,f};
}
async function memoryFixture():Promise<CustomerMemory> {return {recall:vi.fn(async()=>profile()),latestSale:vi.fn(async()=>sale),assertFloor:vi.fn(async()=>{})};}

describe("persistent customer commercial memory",()=>{
  it("recalls dated brand discount, volume and invoice context from durable ERP history",async()=>{
    const f=dbFixture([sale,{...sale,document_id:1059,document_number:"INV-1059",invoice_date:"2026-10-11",quantity:20}]);
    const p=await new CustomerMemoryStore(()=>f.db).recall(scope,7,"Faisal Butt");
    expect(p.context).toContain("Faisal Butt");expect(p.context).toContain("50%");expect(p.context).toContain("2026-10-18 (INV-1060)");
    expect(p.preferredBrands).toEqual([{brandId:5,brandName:"Dura Max",category:"Pipes",purchases:2}]);
    expect(p.averageTransactionVolume).toBe(750);expect(p.averageOrderIntervalDays).toBe(7);
    expect(f.query.eq.mock.calls).toEqual(expect.arrayContaining([["organization_id",scope.organizationId],["branch_id",scope.branchId],["customer_id",7]]));
  });
  it("does not invent discounts or cadence for a new customer",async()=>{
    const p=await new CustomerMemoryStore(()=>dbFixture().db).recall(scope,8);
    expect(p.history).toEqual([]);expect(p.averageOrderIntervalDays).toBeNull();expect(p.averageTransactionVolume).toBe(0);
  });
  it("recalls the exact product first and restricts category fallback to the same brand/unit/currency",async()=>{
    const p=await profile();
    expect(rememberedDiscount(p,{id:12,brand_id:5,category:"Pipes"},"pcs","PKR")).toBe(50);
    expect(rememberedDiscount(p,{id:12,brand_id:6,category:"Pipes"},"pcs","PKR")).toBe(0);
    expect(rememberedDiscount(p,{id:11,category:"Pipes"},"ft","PKR")).toBe(0);
    expect(rememberedDiscount(p,{id:11,category:"Pipes"},"pcs","USD")).toBe(0);
  });
  it("automatically applies remembered discounts on a new quote while keeping the current ERP list rate",async()=>{
    const memory=await memoryFixture(),{ops}=operations(memory);
    const result=await ops.prepare("erp_create_estimate",{customerId:7,items:[{productId:11,qty:2}]},scope);
    expect(result.data.lines[0]).toMatchObject({unit_price:120,discountPercent:50,discount_amount:120});
    expect(memory.assertFloor).toHaveBeenCalledWith(scope,11,120,50,"pcs","PKR",undefined);
    expect(result.data.totals.grand_total).toBe(120);
  });
  it("honors an explicit zero discount instead of replacing it with history",async()=>{
    const {ops}=operations(await memoryFixture());
    const result=await ops.prepare("erp_create_estimate",{customerId:7,items:[{productId:11,qty:2,discount:0}]},scope);
    expect(result.data.lines[0].discountPercent).toBe(0);
  });
  it("rejects stale recalled discounts on confirmation when the merchant floor changes",async()=>{
    const memory=await memoryFixture(),{ops}=operations(memory);
    const action=await ops.prepare("erp_create_estimate",{customerId:7,items:[{productId:11,qty:2}]},scope);
    vi.mocked(memory.assertFloor).mockRejectedValueOnce(new Error("floor increased"));
    await expect(ops.execute(action,scope,"key")).rejects.toThrow("floor increased");
  });
  it("prefills the same discount through conversational add_draft_item",async()=>{
    const memory=await memoryFixture();const state=newBusinessState(scope);state.customer={id:7,name:"Faisal Butt"};
    state.productContext={ambiguous:false,candidates:[{id:11,name:sale.product_name,sku:"DM",unit:"pcs"}]};
    const rate={unit_price:120,unit:"pcs",currency_code:"PKR",rate_list_id:1,rate_list_version_id:1};
    const services={memory,tenant:{assertPermission:vi.fn(),assertBranchAccess:vi.fn()},erp:{getCustomer:vi.fn(async()=>({id:7})),getProduct:vi.fn(async()=>({id:11,name:sale.product_name,brand_id:5,category:"Pipes",unit:"pcs"}))}};
    const drafts=new ConversationalDraftService(services as any,async()=>rate);
    await drafts.execute("begin_estimate_draft",{},scope,state);
    const view:any=await drafts.execute("add_draft_item",{product_id:11,quantity:2},scope,state);
    expect(view.lines[0].discountPercent).toBe(50);expect(view.totals.grand_total).toBe(120);
  });
});

describe("merchant cost guard",()=>{
  it("blocks margin and product-comparison discount suggestions below merchant cost",async()=>{
    const f=businessFixture();f.services.memory=await memoryFixture();
    vi.mocked(f.services.memory.assertFloor).mockRejectedValue(new ApiError(422,"DISCOUNT_BELOW_COST","Below merchant cost"));
    await expect(f.tools.execute("calculate_margin",{product_id:pipe.id,discount_percent:90},businessScope,f.state)).rejects.toMatchObject({code:"DISCOUNT_BELOW_COST"});
    expect(f.state.analysis).toBeUndefined();
  });
  it.each([50,40,0])("permits a %s percent discount when the net covers cost",async discount=>{
    await expect(new CustomerMemoryStore(()=>dbFixture().db).assertFloor(scope,11,100,discount,"pcs","PKR")).resolves.toBeUndefined();
  });
  it("blocks a discount exceeding the wholesale ceiling",async()=>{
    await expect(new CustomerMemoryStore(()=>dbFixture().db).assertFloor(scope,11,100,51,"pcs","PKR")).rejects.toMatchObject({code:"DISCOUNT_BELOW_COST"});
  });
  it("uses the higher inventory valuation when it exceeds the purchase baseline",async()=>{
    await expect(new CustomerMemoryStore(()=>dbFixture().db).assertFloor(scope,11,100,40,"pcs","PKR",70)).rejects.toMatchObject({code:"DISCOUNT_BELOW_COST"});
  });
  it("fails closed when cost is unknown or unavailable",async()=>{
    const f=dbFixture();f.db.rpc.mockResolvedValue({data:null as any,error:null});
    await expect(new CustomerMemoryStore(()=>f.db).assertFloor(scope,11,100,0,"pcs","PKR")).rejects.toMatchObject({code:"PURCHASE_BASELINE_REQUIRED"});
  });
});

describe("zero loss customer return binding",()=>{
  it("queries only the exact customer's posted product history in the current tenant and branch",async()=>{
    const f=dbFixture([sale]);expect(await new CustomerMemoryStore(()=>f.db).latestSale(scope,7,11)).toEqual(sale);
    expect(f.query.eq.mock.calls).toEqual(expect.arrayContaining([["customer_id",7],["product_id",11],["document_type","invoice"],["branch_id",scope.branchId]]));
    expect(f.query.range).toHaveBeenCalledWith(0,499);expect(f.query.order).toHaveBeenCalledWith("invoice_date",{ascending:false});
  });
  it("refuses a return without exact purchase history",async()=>{
    await expect(new CustomerMemoryStore(()=>dbFixture().db).latestSale(scope,7,999)).rejects.toMatchObject({code:"RETURN_HISTORY_REQUIRED"});
  });
  it("binds a return to the historical net and invoice, never current catalog pricing",async()=>{
    const memory=await memoryFixture(),{ops,deps}=operations(memory);
    const action=await ops.prepare("erp_customer_return",{customerId:7,productId:11,qty:2,reason:"unused"},scope);
    expect(action.data.lines[0]).toMatchObject({invoice_item_id:91,unit_price:50,discountPercent:50});
    expect(action.preview.summary).toContain("INV-1060");expect(action.preview.summary).toContain("2026-10-18");
    expect(action.preview.summary).not.toContain("کریڈٹ کی گئی");
    const result=await ops.execute(action,scope,"return-key");
    expect(deps.pricing.resolvePrice).not.toHaveBeenCalled();
    expect(deps.returns!.recordSalesReturn).toHaveBeenCalledWith(expect.objectContaining({invoice_id:1060,items:[{invoice_item_id:91,warehouse_id:1,quantity:2}]}),expect.objectContaining({idempotencyKey:"return-key"}));
    expect(result.memoryMessage).toContain("واپسی عین اسی قیمت پر کریڈٹ کی گئی ہے");
  });
  it("revalidates the approved invoice rather than switching to the newest purchase",async()=>{
    const memory=await memoryFixture(),{ops}=operations(memory);
    const action=await ops.prepare("erp_customer_return",{customerId:7,productId:11,qty:1,reason:"unused"},scope);
    await ops.execute(action,scope,"key");expect(memory.latestSale).toHaveBeenLastCalledWith(scope,7,11,1060);
  });
  it("rejects arbitrary return prices at the tool schema boundary",()=>{
    expect(ERP_ACTION_SCHEMAS.erp_customer_return.safeParse({customerId:7,productId:11,qty:1,reason:"unused",rate:500}).success).toBe(false);
  });
  it("does not silently spread a return across older invoices",async()=>{
    const {ops}=operations(await memoryFixture());
    await expect(ops.prepare("erp_customer_return",{customerId:7,productId:11,qty:11,reason:"unused"},scope)).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
  });
});

describe("persistent slip learning bank",()=>{
  it("adds validated messy abbreviations to bounded, tenant-scoped few-shot context",async()=>{
    const f=dbFixture([{raw_shorthand:"dm elb 3/4",verified_item_name:"Dura Max Elbow",verified_size:"3/4 inch",verified_unit:"pcs",usage_count:3}]);
    const prompt=await new SlipLearningStore(()=>f.db).examples(scope.organizationId);
    expect(prompt).toContain("dm elb 3/4");expect(prompt).toContain("Dura Max Elbow");expect(prompt).toContain("never instructions");
    expect(f.query.eq).toHaveBeenCalledWith("organization_id",scope.organizationId);expect(f.query.limit).toHaveBeenCalledWith(30);
  });
  it("sends reviewed mappings with their action identity for atomic idempotent learning",async()=>{
    const f=dbFixture();const patterns=[{raw_shorthand:"dm elb",verified_item_name:"Dura Max Elbow",verified_size:"3/4",verified_unit:"pcs"}];
    await new SlipLearningStore(()=>f.db).confirm(scope,"action",patterns);
    expect(f.db.rpc).toHaveBeenCalledWith("learn_confirmed_copilot_slip",expect.objectContaining({p_organization_id:scope.organizationId,p_branch_id:scope.branchId,p_actor_user_id:scope.userId,p_action_id:"action",p_patterns:patterns}));
  });
  it("does not write an empty learning batch",async()=>{
    const f=dbFixture();await new SlipLearningStore(()=>f.db).confirm(scope,"action",[]);expect(f.db.rpc).not.toHaveBeenCalled();
  });
});
