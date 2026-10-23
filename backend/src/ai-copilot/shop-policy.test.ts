import {describe,it,expect,vi} from "vitest";
import {DefaultErpOperations} from "./tools/operations.js";
import {resolveCandidates} from "../services/entity-search.service.js";
import {fixture,scope} from "./agent/stateful.test-fixtures.js";
import {ApiError} from "../errors/api-error.js";
import {shopItem,counterTotals,shopDiscount} from "./shop-policy.js";

function operations(){
 const products=[{id:11,name:"Dura Max PPR-C Elbow 25mm",unit:"pcs",brand_id:1,category:"Fittings"},{id:12,name:"Dura Max PPR-C Tee 32mm",unit:"pcs",brand_id:1,category:"Fittings"}];
 const deps:any={principal:"test",database:vi.fn(),erp:{getCustomer:vi.fn(async()=>({id:7,name:"Waseem"})),getProduct:vi.fn(async(id:number)=>products.find(p=>p.id===id)),listInventory:vi.fn(),listWarehouses:vi.fn()},
 search:{getProductBrand:vi.fn(async()=>"Dura Max"),searchProducts:vi.fn(async(q:string)=>resolveCandidates(products.filter(p=>q.includes("Elbow")&&p.id===11).map(p=>({...p,sku:"E25",brandName:"Dura Max",confidence:1,match_kind:"exact_name"})),5))},
 pricing:{resolvePrice:vi.fn(async(input:any)=>input.product_id===11?{product_id:11,unit_price:1035,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8}:null)},
 memory:{recall:vi.fn(async()=>({preferredBrands:[],history:[]})),assertFloor:vi.fn(async()=>{})}};
 return {deps,ops:new DefaultErpOperations(deps)};
}
describe("autonomous shop previews",()=>{
 it("renders an invoice proposal without warehouse, stock or cost verification",async()=>{
  const f=operations();const action=await f.ops.prepare("erp_create_invoice",{customerId:7,brand:"Dura Max",items:[{productId:11,qty:1},{productId:12,qty:2}]},scope);
  expect(action.data.lines).toHaveLength(2);expect(action.data.totals.grand_total).toBe(517.5);
  expect(f.deps.erp.listWarehouses).not.toHaveBeenCalled();expect(f.deps.erp.listInventory).not.toHaveBeenCalled();expect(f.deps.memory.assertFloor).not.toHaveBeenCalled();
 });
 it("keeps every line and prices independent rows when one catalog rate is absent",async()=>{
  const f=operations();const action=await f.ops.prepare("erp_create_estimate",{customerId:7,brand:"Dura Max",items:[{productId:11,qty:1},{productId:12,qty:3}]},scope);
  expect(action.data.lines).toHaveLength(2);expect(action.data.lines[1]).toMatchObject({product_id:12,unit_price:0,pricing_source:"PENDING_RATE",quantity:3});
  expect(action.data.totals).toMatchObject({subtotal:1035,discount_total:517.5,grand_total:517.5,round_off:.5,cash_payable:518});
  expect(f.deps.memory.assertFloor).not.toHaveBeenCalled();expect(f.deps.erp.listInventory).not.toHaveBeenCalled();
  expect((action.preview.quotation as any).sections[0].lines[1].pending).toBe(true);
  await expect(f.ops.execute(action,scope,"pending")).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});expect(f.deps.database).not.toHaveBeenCalled();
 });
 it("retains missing quantities and sizes without guessing them or discarding other rows",async()=>{
  const f=operations();const action=await f.ops.prepare("erp_create_estimate",{customerId:7,items:[{name:"PPR-C Elbow",qty:3},{name:"Elbow 25mm",qty:null},{productId:11,qty:1}]},scope);
  expect(action.data.lines.map((l:any)=>l.pricing_source)).toEqual(["PENDING_RATE","PENDING_RATE","RESOLVED_RATE"]);
  expect(f.deps.search.searchProducts).not.toHaveBeenCalled();
 });
 it("keeps unverified carton counts pending and bills Teflon by the merchant roll rate",async()=>{
  const f=operations();const action=await f.ops.prepare("erp_create_estimate",{customerId:7,items:[{productId:11,qty:2,unit:"carton"},{name:"Teflon Tape",qty:3}]},scope);
  expect(action.data.lines[0].pendingReason).toContain("پیکنگ");expect(action.data.lines[1]).toMatchObject({unit:"roll",unit_price:50,discountPercent:0,pricing_source:"MERCHANT_QUOTE"});
  expect(action.data.totals.grand_total).toBe(150);
 });
 it("normalizes observed shorthand and appends a courteous note",async()=>{
  const f=operations();const action=await f.ops.prepare("erp_create_estimate",{customerId:7,items:[{name:"ایلو",size:"25mm",qty:2,rawShorthand:"ایلو"}]},scope);
  expect(action.data.lines[0].correctionNote).toContain("[ایلو]");expect(action.data.lines[0].unit_price).toBe(1035);
 });
 it("retains PPR material verified by indexed search when a legacy fitting name omits it",async()=>{
  const f=operations();f.deps.erp.getProduct.mockResolvedValue({id:11,name:"Dura Max Elbow 25mm",unit:"pcs",brand_id:1,category:"Fittings"});
  const action=await f.ops.prepare("erp_create_estimate",{customerId:7,brand:"Dura Max",items:[{name:"PPR-C Elbow",size:"25mm",qty:2}]},scope);
  expect(action.data.lines[0]).toMatchObject({product_id:11,unit_price:1035,quantity:2});
 });
 it("resolves hardware defaults while preserving explicit sizes/materials",()=>{
  expect(shopItem({name:"Solvent"}).name).toBe("Solvent 500g");expect(shopItem({name:"Solvent 70g"}).name).toBe("Solvent 70 g");
  expect(shopItem({name:"Gate Valve 32mm"}).name).toContain("Plastic");expect(shopItem({name:"Gate Valve Brass 25mm"}).name).not.toContain("Plastic");
  expect(shopItem({name:'P-Trap 4 inch'}).name).toContain("Single");expect(shopDiscount("HE China")).toBe(35);
  expect(counterTotals({subtotal:100,discount_total:40.4,grand_total:59.6,customer_payable_total:59.6})).toMatchObject({round_off:.4,cash_payable:60});
 });
 it.each(["customer","vendor"])("creates a missing %s from name/location without asking for a phone, then reuses it",async kind=>{
  const f=fixture(),create=vi.fn(async()=>({id:99,name:"New party",city:"Lahore"}));
  f.services.erp.createCustomer=create as any;f.services.erp.createVendor=create as any;
  const search=vi.fn(async()=>resolveCandidates([],5));f.services.search.searchCustomers=search;
  f.services.resolveVendor=search;
  const result=await f.tools.execute("create_"+kind,{name:"New party",location:"Lahore"},scope) as any;
  expect(result).toMatchObject({created:true,id:99});expect(create).toHaveBeenCalledWith({name:"New party",city:"Lahore",phone:""},scope.organizationId);
  search.mockResolvedValue(resolveCandidates([{id:99,name:"New party",city:"Lahore",confidence:1,match_kind:"exact_name"}],5) as any);
  expect(await f.tools.execute("create_"+kind,{name:"New party"},scope)).toMatchObject({created:false,id:99});expect(create).toHaveBeenCalledOnce();
 });
 it("checks write permission before attempting automatic customer creation",async()=>{
  const f=fixture();f.services.erp.createCustomer=vi.fn();vi.mocked(f.services.tenant.assertPermission).mockRejectedValue(new ApiError(403,"FORBIDDEN","denied"));
  await expect(f.tools.execute("create_customer",{name:"New"},scope)).rejects.toMatchObject({status:403});expect(f.services.erp.createCustomer).not.toHaveBeenCalled();
 });
});
