import {describe,it,expect,vi} from "vitest";
import {DefaultErpOperations} from "./tools/operations.js";
import {resolveCandidates} from "../services/entity-search.service.js";
const scope={userId:"a3000000-0000-4000-8000-000000000001",organizationId:"a3000000-0000-4000-8000-000000000002",branchId:"a3000000-0000-4000-8000-000000000003"};
function fixture(){
  const products=[{id:11,name:"PPR-C Pipe 25mm",category:"Pipes"},{id:12,name:"PPR-C Elbow 25mm",category:"Fittings"},{id:13,name:"PPR-C Socket 25mm",category:"Fittings"}].map(p=>({...p,unit:"pcs",brand_id:5}));
  let saved:any;
  const query:any={};for(const method of ["select","eq","order","range"])query[method]=()=>query;
  query.then=(resolve:any)=>Promise.resolve({data:saved?[saved]:[],error:null}).then(resolve);
  const deps:any={principal:"test",database:()=>({from:()=>query}),
    erp:{getCustomer:vi.fn(async()=>null),getProduct:vi.fn(async(id:number)=>products.find(p=>p.id===id)),listInventory:vi.fn(()=>{throw Error("Estimate read stock");})},
    search:{searchCustomers:vi.fn(async()=>resolveCandidates([],5)),getProductBrand:vi.fn(async()=>"Dura Max")},
    pricing:{resolvePrice:vi.fn(async(input:any)=>({product_id:input.product_id,unit_price:(input.product_id-10)*100,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8}))},
    memory:{assertFloor:vi.fn(async()=>{}),recall:vi.fn(),latestSale:vi.fn()},estimates:{getEstimateAggregate:vi.fn()},
  };
  return {deps,ops:new DefaultErpOperations(deps),persist:(action:any)=>{saved={id:"a3000000-0000-4000-8000-000000000009",status:"DRAFT",user_id:scope.userId,action_plan:{branchId:scope.branchId,unifiedAction:action}};}};
}
describe("simulated multi-turn lifecycle (synthetic slip lines)",()=>{
  it("keeps all three slip lines and the customer while correcting pipes to 50 and fittings to 52 percent",async()=>{
    const f=fixture();
    const first=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:11,qty:2},{productId:12,qty:1},{productId:13,qty:3}]},scope);
    expect(first.data.totals.grand_total).toBe(1300);f.persist(first);
    const corrected=await f.ops.prepare("erp_amend_estimate",{draftId:"a3000000-0000-4000-8000-000000000009",pricingRules:[{match:"pipe",discount:50},{match:"fittings",discount:52}]},scope);
    expect(corrected.data.customerName).toBe("خادم حسین پلمبر");
    expect(corrected.data.lines.map((line:any)=>[line.product_id,line.quantity,line.discountPercent])).toEqual([[11,2,50],[12,1,52],[13,3,52]]);
    expect(corrected.data.totals.grand_total).toBe(628);expect(f.deps.erp.listInventory).not.toHaveBeenCalled();
  });
  it("retains unpriced lines and calculates only verified rows, blocking a forged approval",async()=>{
    const f=fixture();f.deps.pricing.resolvePrice.mockImplementation(async(input:any)=>input.product_id===12?null:{product_id:11,unit_price:100,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8});
    const pending=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:11,qty:2},{productId:12,qty:1}]},scope);
    expect(pending.data.lines).toHaveLength(2);expect(pending.data.lines[1].pending).toBe(true);
    expect(pending.preview).toMatchObject({incomplete:true,partialTotals:{grand_total:200}});expect(pending.preview.totals).toBeUndefined();
    await expect(f.ops.execute(pending,scope,"forged-approval")).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
  });
  it("converts an estimate with a partial receipt and rejects overpayment",async()=>{
    const f=fixture();f.deps.estimates.getEstimateAggregate.mockResolvedValue({record:{branch_id:scope.branchId,status:"READY",currency_code:"PKR",customer_id:7},items:[{product_id:11,quantity:2,unit_price:100,discount_amount:0,unit:"pcs"}]});
    vi.spyOn(f.ops as any,"warehouse").mockResolvedValue(1);
    vi.spyOn(f.ops as any,"inventory").mockResolvedValue({unitCost:30,available:10,costSource:"test reconciled valuation"});
    const action=await f.ops.prepare("erp_convert_estimate_to_invoice",{estimateId:101,paidAmount:80},scope);
    expect(action.input.paidAmount).toBe(80);expect(action.data).toMatchObject({paidAmount:80,outstandingAmount:120});
    await expect(f.ops.prepare("erp_convert_estimate_to_invoice",{estimateId:101,paidAmount:201},scope)).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
  });
  it.each([{}, {phone:null,address:null}])("normalizes missing optional customer metadata %j before preparing a transaction",async optional=>{
    const f=fixture();const action=await f.ops.prepare("erp_create_customer",{name:"خادم حسین پلمبر",...optional},scope);
    expect(action.input).toMatchObject({phone:"",address:""});
  });
});
