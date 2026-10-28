import { ApiError } from "../errors/api-error.js";
import { canonicalBrand } from "./productResolver.js";
export interface PricingRule {brand?:string;match:string;discount:number}
export function categoryDiscountChoices(message:string):PricingRule[]{
  if(!/%|فیصد|لیس|\bpercent\b|\bdiscount/iu.test(message))return [];
  const rules:PricingRule[]=[];
  for(const [match,pattern] of [["pipe",/(?:پائپ|\bpipes?\b)\s*(?:(?:پر|at|on)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:%|فیصد|percent))/iu],["fittings",/(?:فٹنگز?|\bfittings?\b)\s*(?:(?:پر|at|on)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:%|فیصد|percent))/iu]] as const){
    const found=message.match(pattern),discount=Number(found?.[1]??found?.[2]);if(found&&discount<=100)rules.push({match,discount});
  }
  return rules.length===2?rules:[];
}
export function classifyMaterial(name:string):"GI"|"PPRC"|"UPVC"|"OTHER" {
  if(/he\s*china|ایچ\s*ای\s*چائنا/iu.test(name))return "GI";
  if(/ppr[ -]?c/iu.test(name))return "PPRC";
  if(/u[ -]?pvc/iu.test(name))return "UPVC";
  return "OTHER";
}
export function applyHybridRules<T extends {name?:string;brand?:string;discount?:number;category?:string}>(item:T,rules:PricingRule[]):T {
  const matches=rules.filter(rule=>{
    const category=rule.match.trim().toLowerCase();
    if(/^(?:pipes?|پائپ)$/u.test(category))return /pipe|پائپ/iu.test(item.category??item.name??"");
    if(/^(?:fittings?|فٹنگ|فٹنگز)$/u.test(category))return /fitting|فٹنگ/iu.test(item.category??"") || /elbow|socket|tee|union|adapter|reducer|coupling|end.?cap|trap|valve|plug|over.?cross|cross.?over|solvent|solution|cement|سلوشن|ساکٹ|ایلبو|یونین/iu.test(item.name??"");
    return (item.name??"").toLowerCase().includes(category);
  });
  if(matches.length>1)throw new ApiError(422,"ERP_ACTION_CLARIFICATION","اس آئٹم پر دو برانڈ یا رعایت کی شرطیں لگ رہی ہیں؛ انتخاب واضح کر دیں: "+item.name);
  const rule=matches[0];
  return rule?{...item,...(rule.brand?{brand:canonicalBrand(rule.brand)}:{}),discount:item.discount??rule.discount}:item;
}
export interface QuotationLine {productName:string;size?:string;brandName?:string;quantity:number;unit:string;unit_price:number;discountPercent?:number;discount_amount?:number;unitCost?:number}
export function groupQuotation(lines:QuotationLine[]) {
  const groups=new Map<string,{brand:string;lines:QuotationLine[];gross:number;savings:number;net:number}>();
  for(const line of lines){
    const brand=line.brandName??"دیگر سامان";
    const group=groups.get(brand)??{brand,lines:[],gross:0,savings:0,net:0};
    group.lines.push(line);group.gross+=line.quantity*line.unit_price;group.savings+=line.discount_amount??0;group.net=group.gross-group.savings;groups.set(brand,group);
  }
  const gross=lines.reduce((sum,line)=>sum+line.quantity*line.unit_price,0),savings=lines.reduce((sum,line)=>sum+(line.discount_amount??0),0);
  const costsKnown=lines.every(line=>line.unitCost!==undefined);
  return {groups:[...groups.values()],gross,savings,grandTotal:gross-savings,
    privateMargin:{basis:"verified merchant costs",costsKnown,cost:costsKnown?lines.reduce((sum,line)=>sum+line.quantity*line.unitCost!,0):null,
      grossProfit:costsKnown?gross-savings-lines.reduce((sum,line)=>sum+line.quantity*line.unitCost!,0):null}};
}
/** Customer-visible card contains no purchase costs or merchant margin. */
export function quotationCard(customer:string,quote:ReturnType<typeof groupQuotation>) {
  return {title:"ایم مراد بلڈنگ مٹیریل سٹور",customer,sections:quote.groups.map(group=>({brand:group.brand,lines:group.lines.map(line=>({
    name:line.productName,size:line.size??null,quantity:line.quantity,unit:line.unit,rate:line.unit_price,discount:line.discount_amount??0,discountPercent:line.discountPercent??(line.quantity*line.unit_price?Math.round((line.discount_amount??0)/(line.quantity*line.unit_price)*10000)/100:0),
    amount:line.quantity*line.unit_price-(line.discount_amount??0)})),savings:group.savings,total:group.net})),grandTotal:quote.grandTotal,
    text:["ایم مراد بلڈنگ مٹیریل سٹور","تخمینہ — "+customer,...quote.groups.flatMap(group=>[group.brand,...group.lines.map(line=>line.productName+" — "+line.quantity+" "+line.unit+"؛ نرخ PKR "+line.unit_price+"؛ رعایت PKR "+(line.discount_amount??0)+"؛ رقم PKR "+(line.quantity*line.unit_price-(line.discount_amount??0))), "برانڈ رعایت: PKR "+group.savings+"؛ رقم: PKR "+group.net]),"کل رقم: PKR "+quote.grandTotal].join("\n")};
}
