import {describe,it,expect,vi} from "vitest";
import {DefaultErpOperations} from "./tools/operations.js";
import {resolveCandidates} from "../services/entity-search.service.js";
const scope={userId:"a3000000-0000-4000-8000-000000000001",organizationId:"a3000000-0000-4000-8000-000000000002",branchId:"a3000000-0000-4000-8000-000000000003"};
function fixture(){
  const products=[{id:11,name:"PPR-C Pipe 25mm",category:"Pipes"},{id:12,name:"PPR-C Elbow 25mm",category:"Fittings"},{id:13,name:"PPR-C Socket 25mm",category:"Fittings"}].map(p=>({...p,unit:"pcs",brand_id:5}));
  let saved:any;
  const query:any={};for(const method of ["select","eq","in","order","range","limit"])query[method]=()=>query;
  query.then=(resolve:any)=>Promise.resolve({data:saved?[saved]:[],error:null}).then(resolve);
  const history:any={};for(const method of ["select","eq","in","order","range","limit"])history[method]=()=>history;
  history.then=(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve);
  const deps:any={principal:"test",database:()=>({from:(table:string)=>table==="estimate_items"?history:query}),
    erp:{getCustomer:vi.fn(async()=>null),getProduct:vi.fn(async(id:number)=>products.find(p=>p.id===id)),listInventory:vi.fn(()=>{throw Error("Estimate read stock");})},
    search:{searchCustomers:vi.fn(async()=>resolveCandidates([],5)),getProductBrand:vi.fn(async()=>"Dura Max")},
    pricing:{resolvePrice:vi.fn(async(input:any)=>({product_id:input.product_id,unit_price:(input.product_id-10)*100,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8}))},
    memory:{assertFloor:vi.fn(async()=>{}),recall:vi.fn(),latestSale:vi.fn()},estimates:{getEstimateAggregate:vi.fn()},
  };
  return {deps,ops:new DefaultErpOperations(deps),persist:(action:any)=>{saved={id:"a3000000-0000-4000-8000-000000000009",status:"DRAFT",user_id:scope.userId,action_plan:{branchId:scope.branchId,unifiedAction:action}};}};
}
describe("simulated multi-turn lifecycle (synthetic slip lines)",()=>{
  it("re-resolves changed sizes and keeps newly observed unlisted rows pending",async()=>{
    const f=fixture();f.deps.search.searchProducts=vi.fn(async()=>resolveCandidates([],5));
    const first=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:11,name:"PPR-C Pipe",size:"25mm",qty:2},{productId:12,qty:3}]},scope);f.persist(first);
    const revised=await f.ops.prepare("erp_amend_estimate",{draftId:"a3000000-0000-4000-8000-000000000009",updateLines:[{lineNumber:1,changes:{size:"32mm"}}],addItems:[{name:"ململ",qty:4,unit:"gaz"},{name:"UPVC Socket",size:"5 inch",qty:4,unit:"pcs"}]},scope);
    expect(revised.data.lines).toHaveLength(4);expect(revised.data.lines[0]).toMatchObject({pending:true,size:"32mm"});expect(revised.data.lines[1]).toMatchObject({product_id:12,quantity:3});
    expect(revised.data.lines[2]).toMatchObject({pending:true,quantity:4,unit:"gaz"});expect(revised.preview).toMatchObject({incomplete:true,partialTotals:{grand_total:600}});
  });
  it("corrects only the chosen row when two rows share the same product",async()=>{
    const f=fixture();const first=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:11,qty:2},{productId:11,qty:3}]},scope);f.persist(first);
    const revised=await f.ops.prepare("erp_amend_estimate",{draftId:"a3000000-0000-4000-8000-000000000009",updateLines:[{lineNumber:1,changes:{qty:4}}]},scope);
    expect(revised.data.lines.map((line:any)=>line.quantity)).toEqual([4,3]);expect(revised.data.totals.grand_total).toBe(700);
  });
  it.each([["Dura Max PPR-C Fittings",false],["Dura Max UPVC Fittings",true]])("requires authoritative material evidence from %s",async(name,pending)=>{
    const f=fixture();f.deps.erp.getProduct.mockResolvedValue({id:12,name:"Dura Max Elbow 25 mm",category:"Fittings",unit:"pcs",brand_id:5});
    f.deps.rates={getRateList:vi.fn(async()=>({name}))};
    const result=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:12,name:"PPR-C Elbow",size:"25mm",qty:1}]},scope);
    expect(Boolean(result.data.lines[0].pending)).toBe(pending);expect(f.deps.rates.getRateList).toHaveBeenCalledWith(4,scope.organizationId);
  });
  it("retains a mismatched catalog specification as a pending line",async()=>{
    const f=fixture();
    const pending=await f.ops.prepare("erp_create_estimate",{customerName:"خادم حسین پلمبر",items:[{productId:11,qty:2},{productId:12,name:"PPR-C Elbow",size:"32mm",qty:1}]},scope);
    expect(pending.data.lines).toHaveLength(2);expect(pending.data.lines[1].pending).toBe(true);
    expect(pending.preview).toMatchObject({incomplete:true,partialTotals:{grand_total:200}});
  });
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
