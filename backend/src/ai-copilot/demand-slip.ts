import {categoryDiscountChoices} from './hybridQuotationEngine.js';
export const DEMAND_SLIP_ESTIMATE='DEMAND_SLIP_ESTIMATE' as const;
export const hardwareKinds=['cloth','thread','teflon','connection_pipe','saw_blade','blade'] as const;
const labels:Record<string,string>={cloth:'ململ (کپڑا)',thread:'دھاگہ',teflon:'ٹیفلون ٹیپ',connection_pipe:'کنکشن پائپ',saw_blade:'آری بلیڈ',blade:'بلیڈ'};
export function hardwareKind(name:string):typeof hardwareKinds[number]|undefined{
  if(/ململ|کپڑا|سمل|malmal|muslin|cloth/iu.test(name))return 'cloth';
  if(/دھاگ|دکھار|\bdha+ga\b|thread\s*(?:ball|roll)|\bthread\b(?!ed)/iu.test(name))return 'thread';
  if(/ٹیفلون|ٹیفلن|teflon|ptfe|t[ae]fl[ou]n/iu.test(name))return 'teflon';
  if(/کنکشن|کنیکشن|connection\s*pipe/iu.test(name))return 'connection_pipe';
  if(/آری|آر[یے]|hacksaw|saw.?blade|(?:ari|axi).?blade|blade.?\b(?:ari|axi)\b/iu.test(name))return 'saw_blade';
  if(/بلیڈ|blade/iu.test(name))return 'blade';
}
export function hardwareLabel(name:string){return labels[hardwareKind(name)??'']??name;}
export function demandRequested(message:string,task?:string){return task==='estimate'||/ایسٹیمیٹ|اسٹیمیٹ|تخمینہ|لیس|\b(?:estimate|quotation|demand|quote)\b/iu.test(message);}
export function demandDiscounts(message:string){
  const rules=categoryDiscountChoices(message);if(rules.length)return rules;
  const values=[...message.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|فیصد)/gu)].map(x=>Number(x[1]));
  return values.length===2&&values.every(x=>x<=100)?[{match:'pipe',discount:values[0]!},{match:'fittings',discount:values[1]!}]:[];
}
export function hardwareInstructions(message:string){
  const hardwareRates:Array<{kind:typeof hardwareKinds[number];rate:number}>=[];
  const clauses=message.split(/اور|،|,|\band\b/iu);
  for(const clause of clauses){
    if(/نہ\s*لگا|مت\s*لگا|نہیں\s*لگا|do\s+not|don't|never|[؟?]/iu.test(clause))continue;
    const kind=hardwareKind(clause);const match=clause.match(/(?:ململ|کپڑا|دھاگہ?|ٹیفلون\s*ٹیپ|کنکشن\s*پائپ|آری\s*بلیڈ|بلیڈ|cloth|thread|teflon|connection\s*pipe|saw\s*blade|blade)\s*(?:کا|کی|کو|پر|at|@)?\s*(\d+(?:\.\d+)?)\s*(?:روپے?|روپیہ|rs\.?|pkr)/iu);
    if(kind&&match)hardwareRates.push({kind,rate:Number(match[1])});
  }
  const catalog=/(?:سافٹ\s*ویئر|سافٹویئر|software|hardware|ہارڈویئر).{0,30}(?:ریٹ|نرخ|rates?|prices?).{0,20}(?:لگا|استعمال|use|apply)|(?:use|apply).{0,20}(?:software|hardware).{0,20}(?:rates?|prices?)/iu.test(message);
  return {hardwareRates,...(catalog&&!/نہ\s*لگا|مت\s*لگا|نہیں\s*لگا|do\s+not|don't|never|[؟?]/iu.test(message)?{hardwarePricing:'catalog' as const}:{})};
}
export function hardwarePrompt(lines:any[]){
  const rows=lines.filter(x=>x.pending&&x.hardware);
  if(!rows.length)return '';
  return 'جناب، مندرجہ ذیل متفرق آئٹمز ڈیورا میکس کی لسٹ میں شامل نہیں ہیں:\n'+rows.map((x,i)=>`${i+1}. ${hardwareLabel(x.productName)}${x.size?' '+x.size:''}: ${x.quantity} ${hardwareKind(x.productName)==='thread'?'گولے':x.unit==='gaz'?'گز':x.unit==='pcs'?'عدد':x.unit} — ریٹ مطلوب`).join('\n')+'\nکیا ان پر ہمارے سافٹ ویئر میں موجود عام ہارڈویئر ریٹ لگا دوں، یا آپ ان کی قیمت بتانا پسند کریں گے؟';
}
