import type { AgentScope,ToolServices } from "./agent/erp-tools.js";
import { sameBrand } from "./productResolver.js";
/** Merchant-specified review baselines. These are never substituted for an ERP
 * rate. Any mismatch must be corrected through an approved rate-change draft. */
export const DURA_CATALOG_BASELINES=[
  {query:'Dura Max U-PVC Medium 4 inch',listPrice:5418,pattern:/u[\s-]*pvc.*medium\s+4\s*(?:"|inch)/i},
  {query:'Dura Max U-PVC Medium 3 inch',listPrice:4127,pattern:/u[\s-]*pvc.*medium\s+3\s*(?:"|inch)/i},
  {query:'Dura Max U-PVC Medium 2 inch',listPrice:2624,pattern:/u[\s-]*pvc.*medium\s+2\s*(?:"|inch)/i},
  {query:'Dura Max P Trap Single 4 inch',listPrice:1259,pattern:/p[\s-]*trap\s*\(?single\)?\s+4\s*(?:"|inch)/i},
  {query:'Dura Max P Trap Single 3 inch',listPrice:1035,pattern:/p[\s-]*trap\s*\(?single\)?\s+3\s*(?:"|inch)/i},
  {query:'Dura Max Gate Valve Plastic 32mm',listPrice:1889,pattern:/gate\s+valve.*plastic.*32\s*mm/i},
  {query:'Dura Max Gate Valve Plastic 25mm',listPrice:1492,pattern:/gate\s+valve.*plastic.*25\s*mm/i},
  {query:'Dura Max Solvent Solution 500g',listPrice:1104,pattern:/(?:solvent|solution).*500\s*(?:g|gm|grams?)/i},
];
export function duraCatalogBaseline(name:string,brand:string|undefined){
  return sameBrand(brand,"Dura Max")?DURA_CATALOG_BASELINES.find(row=>row.pattern.test(name)):undefined;
}
export async function auditDuraCatalog(services:ToolServices,scope:AgentScope){
  await services.tenant.assertPermission(scope,"sales.read");
  const rows=await Promise.all(DURA_CATALOG_BASELINES.map(async baseline=>{
    const match=await services.search.searchProducts(baseline.query,5,scope,"Dura Max");
    if(match.resolution!=="resolved"||!match.bestCandidate)return {name:baseline.query,expectedListPrice:baseline.listPrice,discountPercent:50,status:"unresolved",currentListPrice:null};
    const product=match.bestCandidate,rate=await services.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity:1,as_of:new Date().toISOString()});
    return {name:product.name,productId:product.id,expectedListPrice:baseline.listPrice,discountPercent:50,currentListPrice:rate?.unit_price??null,rateListId:rate?.rate_list_id,status:rate?.unit_price===baseline.listPrice?"verified":"correction_required"};
  }));
  const corrections=rows.filter(row=>row.status==="correction_required");
  return {analytics:true,answer:rows.map(row=>`${row.name}: موجودہ ${row.currentListPrice??"نرخ دستیاب نہیں"}؛ فراہم کردہ کیٹلاگ ${row.expectedListPrice}؛ رعایت 50%۔ ${row.status==="verified"?"تصدیق شدہ":row.status==="unresolved"?"درست کیٹلاگ آئٹم واضح کریں":"درستگی کا پری ویو اور منظوری درکار ہے"}`).join("\n"),
    report:{catalogIntegrity:true,rows,corrections:corrections.map(row=>({productId:row.productId,newPrice:row.expectedListPrice,rateListId:row.rateListId})),requiresConfirmation:corrections.length>0},
    nextAction:corrections.length?"If the merchant requested corrections, prepare erp_update_commodity_rates with these exact product IDs, prices and rateListIds and an audit reason. Wait for one explicit confirmation. No rate has been changed.":null};
}
