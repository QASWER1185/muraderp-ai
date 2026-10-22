import {describe,it,expect,vi} from "vitest";
import {canonicalCatalogQuery,matchesProductSpecification} from "./productResolver.js";
import {auditDuraCatalog,duraCatalogBaseline,DURA_CATALOG_BASELINES} from "./catalogIntegrity.js";
import {canonicalSlipWords} from "./conversationalMunshi.js";
import {fixture,scope} from "./agent/stateful.test-fixtures.js";
import {rememberedDiscount} from "./customerMemoryStore.js";
describe("one-to-one Dura catalog variants",()=>{
  it("restricts unspecified Dura pipe/trap/valve variants without altering explicit variants",()=>{
    expect(canonicalCatalogQuery('Dura Max U-PVC Pipe 4 inch',"Dura Max")).toContain("Medium");
    expect(canonicalCatalogQuery('Dura Max P Trap 4 inch',"Dura Max")).toContain("Single");
    expect(canonicalCatalogQuery('Dura Max Gate Valve 25mm',"Dura Max")).toContain("Plastic");
    expect(canonicalCatalogQuery('Dura Max Gate Valve Metal 25mm',"Dura Max")).not.toContain("Plastic");
    expect(canonicalCatalogQuery('Popular U-PVC Pipe 4 inch',"Popular")).not.toContain("Medium");
  });
  it.each([
    ['Medium Pipe 4 inch','Class O Pipe 4 inch'],
    ['P Trap Single 4 inch','P Trap 4 inch'],
    ['Gate Valve Plastic 25mm','Gate Valve Metal 25mm'],
    ['Elbow 90° 2 inch','Elbow 45° 2 inch'],
    ['Solvent Solution 500g','Solvent Solution 1000g'],
    ['U-PVC Elbow 2 inch','PPR-C Elbow 2 inch'],
  ])("rejects catalog substitution from %s to %s",(query,candidate)=>expect(matchesProductSpecification(query,candidate)).toBe(false));
  it("preserves Urdu angles, inch sizes, and PPRC pressure specs",()=>{
    const query=canonicalSlipWords('ڈیورا میکس یو پی وی سی ایلبو 90 ڈگری 2 انچ');
    expect(matchesProductSpecification(query,'DURA MAX ELBOW 90° 2"')).toBe(true);
    expect(matchesProductSpecification(query,'DURA MAX ELBOW 45° 2"')).toBe(false);
    expect(canonicalSlipWords('Dura Max PPRC Pipe PN-16 25mm')).toContain("PPR-C");
  });
  it("audits authoritative active prices and only proposes corrections",async()=>{
    const f=fixture();vi.mocked(f.services.search.searchProducts).mockImplementation(async(query)=>({resolution:"resolved",requiresClarification:false,hasMore:false,items:[],bestCandidate:{id:10,name:query,confidence:1,match_kind:"exact_name",sku:"DM",category:"Fittings",unit:"pcs",brandName:"Dura Max"}}));
    const result=await auditDuraCatalog(f.services,scope);expect(result.report.rows).toHaveLength(DURA_CATALOG_BASELINES.length);expect(result.report.corrections).toContainEqual({productId:10,newPrice:1492,rateListId:4});expect(f.erpWrite).not.toHaveBeenCalled();
  });
  it("uses a supplied commercial discount only as fallback, preserving explicit historical zero",()=>{
    expect(duraCatalogBaseline('Dura Max P Trap (Single) 4"','Dura Max')?.listPrice).toBe(1259);
    expect(duraCatalogBaseline('Popular P Trap (Single) 4"','Popular')).toBeUndefined();
    expect(rememberedDiscount({history:[]} as any,{id:1,category:"Fittings"},"pcs","PKR",50)).toBe(50);
    expect(rememberedDiscount({history:[{product_id:1,unit:"pcs",currency_code:"PKR",discount_percent:0}]} as any,{id:1,category:"Fittings"},"pcs","PKR",50)).toBe(0);
  });
});
