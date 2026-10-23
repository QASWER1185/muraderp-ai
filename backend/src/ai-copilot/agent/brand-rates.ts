import {ApiError} from "../../errors/api-error.js";
import { SHOP_DISCOUNTS } from "../shop-policy.js";
import type {AgentScope,ToolServices} from "./erp-tools.js";
import {canonicalBrand,sameBrand} from "../productResolver.js";

// Merchant-requested comparison terms. These are sale discounts, not inferred
// purchase costs, and never override customer history or transaction floors.
const tradeDiscounts=SHOP_DISCOUNTS;
export async function brandRates(input:{query:string;brands:string[];quantity:number;discount_percent?:number|undefined},scope:AgentScope,services:ToolServices,signal?:AbortSignal){
  await services.tenant.assertPermission(scope,"products.read");
  const rows=await Promise.all([...new Set(input.brands.map(canonicalBrand))].map(async brand=>{
    const match=await services.search.searchProducts(input.query,5,scope,brand);
    signal?.throwIfAborted();
    const product=match.resolution==="resolved"?match.bestCandidate:null;
    const discountPercent=input.discount_percent??tradeDiscounts[brand]??null;
    if(!product||!sameBrand(product.brandName,brand))return {brand,product:null,listPrice:null,discountPercent,netPrice:null,unit:null,currency:"PKR",status:match.items.length?"سائز یا قسم منتخب کریں":"فعال کیٹلاگ آئٹم نہیں ملا"};
    const rate=await services.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity:input.quantity,as_of:new Date().toISOString()});
    signal?.throwIfAborted();
    if(!rate)return {brand,product:product.name,listPrice:null,discountPercent,netPrice:null,unit:product.unit,currency:"PKR",status:"فعال نرخ نہیں ملا"};
    const version=await services.rateLists.getVersion(rate.rate_list_version_id);
    if(version.rate_list_id!==rate.rate_list_id||rate.product_id!==product.id||rate.unit!==product.unit)throw new ApiError(502,"RATE_SOURCE_INVALID","The sale-rate source could not be verified.");
    let netPrice=discountPercent==null?null:Math.round((rate.unit_price-rate.unit_price*discountPercent/100)*100)/100;
    let status=discountPercent==null?"رعایت متعین نہیں":"فعال نرخ";
    return {brand,product:product.name,productId:product.id,listPrice:rate.unit_price,discountPercent,netPrice,unit:rate.unit,currency:rate.currency_code,status,rateListId:rate.rate_list_id,rateListVersionId:rate.rate_list_version_id};
  }));
  const alternatives:Array<{productId:number;name:string;brand:string|null;listPrice:number;unit:string;stock:number|null}>=[];
  if(rows.length===1 && rows[0]!.listPrice==null){
    const match=await services.search.searchProducts(input.query,5,scope);
    const product=match.resolution==="resolved"?match.bestCandidate:null;
    if(product && !sameBrand(product.brandName,rows[0]!.brand)){
      const rate=await services.pricing.resolvePrice({organization_id:scope.organizationId,price_type:"SALE",product_id:product.id,quantity:input.quantity,as_of:new Date().toISOString()});
      if(rate && rate.unit===product.unit){
        let stock:number|null=null;
        if(services.erp.listInventory){
          await services.tenant.assertPermission(scope,"inventory.read");
          const inventory=await services.erp.listInventory({product_id:product.id,limit:100},scope.organizationId);
          stock=inventory.data.reduce((sum,row)=>sum+Number(row.quantity),0);
        }
        alternatives.push({productId:product.id,name:product.name,brand:product.brandName,listPrice:rate.unit_price,unit:rate.unit,stock});
      }
    }
  }
  const money=(n:number|null)=>n==null?"—":n.toLocaleString("en-PK",{minimumFractionDigits:2,maximumFractionDigits:2});
  const answer="**جی جناب، فعال ریٹ لسٹ کے مطابق نرخ یہ ہیں:**\n\n| برانڈ | لسٹ ریٹ PKR | رعایت | حتمی ریٹ PKR | یونٹ |\n|---|---:|---:|---:|---|\n"+
    rows.map(row=>`| ${row.brand} | ${money(row.listPrice)} | ${row.discountPercent??"—"}% | ${money(row.netPrice)} | ${row.unit??"—"} |`).join("\n")+
    "\n\n"+rows.map(row=>row.brand+": "+(row.product??input.query)+" — "+row.status).join("\n")+"\nموازنہ اسی سائز اور فی درج شدہ یونٹ کا ہے؛ مختلف یونٹس کا خودکار تقابل نہیں کیا گیا۔";
  const alternativeText=alternatives.length?"\n\nالگ متبادل: "+alternatives.map(row=>row.name+" — PKR "+row.listPrice+" / "+row.unit+(row.stock==null?"؛ کیٹلاگ میں دستیاب":row.stock>0?"؛ ادارے کے گوداموں میں اسٹاک "+row.stock:"؛ اسٹاک پینڈنگ")).join("\n"):"";
  return {analytics:true,answer:answer+alternativeText,brandRateComparison:true,report:{kind:"brand_rates",query:input.query,rows,alternatives}};
}
