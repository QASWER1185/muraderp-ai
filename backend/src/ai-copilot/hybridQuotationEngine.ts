import { ApiError } from "../errors/api-error.js";
import { canonicalBrand } from "./productResolver.js";
export interface PricingRule {brand:string;match:string;discount:number}
export function classifyMaterial(name:string):"GI"|"PPRC"|"UPVC"|"OTHER" {
  if(/he\s*china|ایچ\s*ای\s*چائنا/iu.test(name))return "GI";
  if(/ppr[ -]?c/iu.test(name))return "PPRC";
  if(/u[ -]?pvc/iu.test(name))return "UPVC";
  return "OTHER";
}
export function applyHybridRules<T extends {name?:string;brand?:string;discount?:number}>(item:T,rules:PricingRule[]):T {
  const matches=rules.filter(rule=>(item.name??"").toLowerCase().includes(rule.match.toLowerCase()));
  if(matches.length>1)throw new ApiError(422,"ERP_ACTION_CLARIFICATION","اس آئٹم پر دو برانڈ یا رعایت کی شرطیں لگ رہی ہیں؛ انتخاب واضح کر دیں: "+item.name);
  const rule=matches[0];
  return rule?{...item,brand:canonicalBrand(rule.brand),discount:item.discount??rule.discount}:item;
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
