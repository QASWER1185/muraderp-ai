import { classifyMaterial } from "./hybridQuotationEngine.js";
export interface AuditLine {productId:number;name:string;quantity:number;unitPrice:number;discount:number;specification:string;unitCost?:number;expectedWholesaleDiscount?:number}
export function reconcileVendorQuote(demand:AuditLine[],vendor:AuditLine[]) {
  const issues:Array<{kind:string;productId:number;message:string;negativeMargin?:boolean}>=[];
  const corrected:AuditLine[]=[];
  for(const requested of demand){
    const offered=vendor.find(row=>row.productId===requested.productId);
    if(!offered){issues.push({kind:"missing",productId:requested.productId,message:requested.name+" وینڈر کوٹیشن میں موجود نہیں۔"});corrected.push({...requested});continue;}
    if(offered.quantity!==requested.quantity)issues.push({kind:"quantity",productId:requested.productId,message:requested.name+" کی مقدار پرچی سے مختلف ہے۔"});
    if(offered.specification.toLowerCase()!==requested.specification.toLowerCase() || classifyMaterial(offered.name)!==classifyMaterial(requested.name))
      issues.push({kind:"specification",productId:requested.productId,message:requested.name+" کی قسم یا معیار میں تبدیلی ہے۔"});
    if(requested.expectedWholesaleDiscount==null)issues.push({kind:"discount_unverified",productId:requested.productId,message:requested.name+" کی مجاز ہول سیل رعایت واضح نہیں؛ وینڈر کی رعایت خود سے نہیں بدلی گئی۔"});
    else if(offered.discount!==requested.expectedWholesaleDiscount)issues.push({kind:"discount",productId:requested.productId,message:requested.name+" کی طے شدہ ہول سیل رعایت مختلف ہے۔"});
    const sale=requested.unitPrice*(1-requested.discount/100),cost=offered.unitCost??offered.unitPrice*(1-offered.discount/100);
    if(cost>sale)issues.push({kind:"negative_margin",productId:requested.productId,message:requested.name+" میں خرید لاگت فروخت سے زیادہ ہے۔",negativeMargin:true});
    corrected.push({...offered,quantity:requested.quantity,specification:requested.specification,discount:requested.expectedWholesaleDiscount??offered.discount});
  }
  for(const line of vendor)if(!demand.some(row=>row.productId===line.productId))issues.push({kind:"extra",productId:line.productId,message:line.name+" اصل طلب میں شامل نہیں۔"});
  return {issues,corrected,requiresReview:issues.length>0,basis:"merchant-provided demand and vendor observations; no purchase posted"};
}
