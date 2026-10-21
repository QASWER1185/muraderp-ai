import { describe,it,expect,vi } from "vitest";
import { InstallationCompletenessService } from "./installationCompletenessService.js";
import { applyHybridRules,classifyMaterial,groupQuotation,quotationCard } from "./hybridQuotationEngine.js";
import { reconcileVendorQuote } from "./vendorQuoteAudit.js";
import { canonicalSlipWords,landedCost,rateFreeChallan } from "./conversationalMunshi.js";
import { canonicalBrand,explicitBrand,sameBrand } from "./productResolver.js";
import { DefaultErpOperations } from "./tools/operations.js";
import { resolveCandidates,SupabaseEntitySearchService } from "../services/entity-search.service.js";
import { MultimodalAgentInput } from "./agent/multimodal-input.js";
import { ProviderBusinessInput } from "../ai-input/business-input.provider.js";
import { createCanvas } from "@napi-rs/canvas";

const scope={userId:"11111111-1111-4111-8111-111111111111",organizationId:"22222222-2222-4222-8222-222222222222",branchId:"33333333-3333-4333-8333-333333333333"};
const media=()=>({mimeType:"image/png",base64:createCanvas(100,100).toBuffer("image/png").toString("base64")});
const document=(index:number)=>({customerName:"Waseem Mazhar Bhai",customerAddress:"Ittehad Town, Lahore",requestedBrand:"Dura Max",vendorName:null,warehouseName:null,documentNumber:null,documentDate:null,currencyCode:"PKR",
  lines:[{productName:"PPR-C Elbow "+(25+index)+"mm",productCode:null,brandHint:"Dura Max",quantity:index+1,unit:"pcs",unitRate:99999,discountPercent:50,confidence:.99}],
  observedLineCount:1,ignoredLineCount:0,discountPercent:50,subtotal:null,total:null,confidence:.99,warnings:[]});
function operations(){
  const product={id:11,name:"Dura Max PPR-C Elbow 25mm",unit:"pcs",brand_id:5,category:"Fittings"};
  const deps:any={
    principal:"test",database:()=>({rpc:vi.fn(async()=>({data:{estimate:{id:101,customer_id:77,status:"DRAFT"}},error:null}))}),
    erp:{getCustomer:vi.fn(async()=>null),getProduct:vi.fn(async()=>product),listInventory:vi.fn(async()=>{throw Error("Estimate must never read inventory");}),listWarehouses:vi.fn()},
    search:{searchCustomers:vi.fn(async()=>resolveCandidates([],5)),searchProducts:vi.fn(async()=>resolveCandidates([{...product,brandName:"Dura Max",confidence:1,match_kind:"exact_name"}],5)),getProductBrand:vi.fn(async()=>"Dura Max")},
    pricing:{resolvePrice:vi.fn(async()=>({product_id:11,unit_price:100,unit:"pcs",currency_code:"PKR",rate_list_id:4,rate_list_version_id:8}))},
    memory:{recall:vi.fn(),assertFloor:vi.fn(async()=>{}),latestSale:vi.fn()},estimates:{getEstimateAggregate:vi.fn()},
  };
  return {deps,product,ops:new DefaultErpOperations(deps)};
}
describe("V9 installation completeness",()=>{
  const service=new InstallationCompletenessService();
  it.each([["Commode",7],["Gas Geyser",4],["Electric Geyser",3],["Ceiling Fan",5],["Water Pump",3],["DB Panel",4]])("audits %s without adding items silently",(name,count)=>{
    const result=service.audit([{name,quantity:1}]);expect(result).toHaveLength(count);expect(service.prompt(result)).toContain("حاجی صاحب");expect(result.every(item=>!("price" in item))).toBe(true);
  });
  it("requires two T-cocks per commode and subtracts quantities already on the slip",()=>{
    const result=service.audit([{name:"Commode",quantity:2},{name:"T Cock",quantity:3}]);expect(result.find(item=>item.key==="wc:t-cock")?.quantity).toBe(1);
    expect(service.audit([{name:"Commode",quantity:1},{name:"T Cock",quantity:2}]).some(item=>item.key==="wc:t-cock")).toBe(false);
  });
  it.each(["U-PVC drainage pipe","PPR-C Pipe 25mm","Wash Basin","Tile Bond","Roof Slab Concrete"])("covers %s",name=>expect(service.audit([{name,quantity:1}]).length).toBeGreaterThan(0));
});
describe("V9 quotation authority and privacy",()=>{
  it("prepares missing Waseem + all Dura items at 50% with ZERO stock reads",async()=>{
    const f=operations();const action=await f.ops.prepare("erp_create_estimate",{customerName:"Waseem Mazhar Bhai",customerAddress:"Ittehad Town, Lahore",brand:"Dera Max",discountScheme:{percent:50},items:[{name:"PPR-C Elbow",size:"25mm",qty:3,unit:"pieces"}]},scope);
    expect(action.data.newCustomer).toEqual({name:"Waseem Mazhar Bhai",city:"Ittehad Town, Lahore",phone:""});
    expect(action.data.lines[0]).toMatchObject({product_id:11,quantity:3,unit_price:100,discountPercent:50,discount_amount:150});
    expect(action.data.totals.grand_total).toBe(150);expect(action.preview.summary).toContain("بطور نیا گاہک");
    expect(f.deps.erp.listInventory).not.toHaveBeenCalled();expect(f.deps.erp.listWarehouses).not.toHaveBeenCalled();
    expect(f.deps.memory.recall).not.toHaveBeenCalled();expect(f.deps.search.searchProducts).toHaveBeenCalledWith("PPR-C Elbow 25mm",5,scope,"Dera Max");
    const result=await f.ops.execute(action,scope,"one-approval");expect(result).toMatchObject({id:101,customerId:77});
  });
  it("rejects another brand even if the model supplies its product ID",async()=>{
    const f=operations();f.deps.search.getProductBrand.mockResolvedValue("Popular");
    await expect(f.ops.prepare("erp_create_estimate",{customerName:"Waseem Mazhar",brand:"Dura Max",items:[{productId:11,qty:1}]},scope)).rejects.toMatchObject({code:"ERP_ACTION_CLARIFICATION"});
    expect(f.deps.pricing.resolvePrice).not.toHaveBeenCalled();
  });
  it("never lists Popular candidates under an explicit Dura brand restriction",async()=>{
    const f=operations();f.deps.search.searchProducts.mockResolvedValue(resolveCandidates([{...f.product,brandName:"Popular",name:"Popular elbow",confidence:1,match_kind:"exact_name"}],5));
    await expect(f.ops.prepare("erp_create_estimate",{customerName:"Waseem",brand:"Dura Max",items:[{name:"Elbow 25mm",qty:1}]},scope)).rejects.toThrow(/Dura Max/);
    try{await f.ops.prepare("erp_create_estimate",{customerName:"Waseem",brand:"Dura Max",items:[{name:"Elbow 25mm",qty:1}]},scope);}catch(error){expect((error as Error).message).not.toContain("Popular");}
  });
  it("filters in the database BEFORE ranking and still rejects malformed cross-brand RPC results",async()=>{
    const rpc=vi.fn(async()=>({data:[{id:1,name:"Popular Elbow",sku:"P",category:"Fittings",unit:"pcs",brand_name:"Popular",confidence:1,match_kind:"exact_name"}],error:null}));
    const search=new SupabaseEntitySearchService(()=>({rpc}) as any);
    expect(await search.searchProducts("Elbow 25mm",5,scope,"Dera Max")).toMatchObject({resolution:"no_match",items:[]});
    expect(rpc).toHaveBeenCalledWith("search_catalog_products",expect.objectContaining({p_brand:"Dura Max",p_query:"Elbow 25mm"}));
  });
  it("keeps mixed brands separate and HE China strictly GI",()=>{
    const rules=[{match:"PPR-C pipe",brand:"Turk Plast",discount:45},{match:"fittings",brand:"Popular",discount:41}];
    expect(applyHybridRules({name:"PPR-C pipe 25mm"},rules)).toMatchObject({brand:"turk plast",discount:45});
    expect(explicitBrand("Turk Plast pipe, Popular fittings, Dura Max UPVC, HE China GI")).toBeUndefined();
    expect(classifyMaterial("HE China brass fitting")).toBe("GI");expect(sameBrand("Dura Max",canonicalBrand("DeraMax"))).toBe(true);
    const quote=groupQuotation([{productName:"Turk Plast PPR-C 25mm",brandName:"Turk Plast",quantity:2,unit:"pcs",unit_price:100,discount_amount:90,unitCost:40},
      {productName:"Popular fitting 25mm",brandName:"Popular",quantity:1,unit:"pcs",unit_price:200,discount_amount:82,unitCost:80}]);
    expect(quote.groups).toHaveLength(2);expect(quote.grandTotal).toBe(228);expect(quote.privateMargin.grossProfit).toBe(68);
    const card=quotationCard("Waseem Mazhar",quote);expect(JSON.stringify(card)).not.toMatch(/unitCost|grossProfit|privateMargin/);
  });
  it("audits vendor quantity, spec downgrade, discount and negative margin",()=>{
    const requested={productId:1,name:"Dura Max Medium Pipe 4 inch",quantity:10,unitPrice:100,discount:50,specification:"Medium",expectedWholesaleDiscount:50};
    const result=reconcileVendorQuote([requested],[{...requested,quantity:8,specification:"Conduit",discount:20,unitCost:60}]);
    expect(result.issues.map(issue=>issue.kind)).toEqual(["quantity","specification","discount","negative_margin"]);
    expect(result.corrected[0]).toMatchObject({quantity:10,specification:"Medium",discount:50});
  });
  it("computes landed costs and emits a rate-free challan",()=>{
    expect(landedCost({quantity:10,baseUnitCost:100,carriage:50,unloadingPerUnit:5})).toMatchObject({total:1100,unitCost:110});
    const challan=rateFreeChallan({number:"DC-1",customer:"Waseem",site:"Site B",lines:[{name:"Dura Max Pipe",size:"25mm",quantity:3,unit:"pcs"}]});
    expect(challan.text).toContain("▢");expect(JSON.stringify(challan)).not.toMatch(/price|rate|address|cost/i);
    expect(canonicalSlipWords("ایلبو 25mm Dera Max")).toBe("Elbow 25mm Dura Max");
  });
});
describe("V9 multi-slip consolidation and count checks",()=>{
  it("consolidates 3 images into one 3-line proposal without using observed prices",async()=>{
    const provider={generate:vi.fn(async(_schema:unknown,_instructions:string,content:unknown[])=>document(Number(JSON.stringify(content).match(/([123])\.png/)?.[1])-1)),transcribe:vi.fn()};
    const result=await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({source:"image",task:"estimate",message:"Waseem Mazhar Bhai Dura Max 50%",attachments:[1,2,3].map(i=>({fileName:i+".png",media:media()}))},scope);
    expect(provider.generate).toHaveBeenCalledTimes(3);expect(result.estimateRequest?.items).toHaveLength(3);
    expect(result.extraction.document?.observedLineCount).toBe(3);expect(result.extraction.document?.lines.map(line=>line.quantity)).toEqual([1,2,3]);
    expect(JSON.stringify(result.estimateRequest)).not.toContain("99999");expect(result.reviewRequired).toBe(false);
  });
  it("prevents silent dropped lines when the observed checksum disagrees",async()=>{
    const provider={generate:vi.fn(async()=>({...document(0),observedLineCount:3})),transcribe:vi.fn()};
    const result=await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({source:"image",task:"estimate",media:media()},scope);
    expect(result.reviewRequired).toBe(true);expect(result.extraction.document?.warnings.join(" ")).toContain("گنتی");
  });
  it("retains 300 slip lines in one structured proposal rather than a representative subset",async()=>{
    const provider={generate:vi.fn(async()=>({...document(0),observedLineCount:100,lines:Array.from({length:100},()=>document(0).lines[0])})),transcribe:vi.fn()};
    const result=await new MultimodalAgentInput(new ProviderBusinessInput(provider)).normalize({source:"image",task:"estimate",attachments:[1,2,3].map(()=>({media:media()}))},scope);
    expect(result.estimateRequest?.items).toHaveLength(300);expect(result.extraction.document?.observedLineCount).toBe(300);expect(result.reviewRequired).toBe(false);
  });
});
