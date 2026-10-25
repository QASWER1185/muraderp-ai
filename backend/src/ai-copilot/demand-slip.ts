import {categoryDiscountChoices} from './hybridQuotationEngine.js';
export const DEMAND_SLIP_ESTIMATE='DEMAND_SLIP_ESTIMATE' as const;
export const hardwareKinds=['cloth','thread','teflon','connection_pipe','saw_blade','blade','brass_nipple','handle_valve'] as const;
const labels:Record<string,string>={cloth:'ململ (کپڑا)',thread:'دھاگہ',teflon:'ٹیفلون ٹیپ',connection_pipe:'کنکشن پائپ',saw_blade:'آری بلیڈ',blade:'بلیڈ',brass_nipple:'براس نپل',handle_valve:'ہینڈل والو'};
export function hardwareKind(name:string):typeof hardwareKinds[number]|undefined{
  if(/ململ|کپڑا|سمل|malmal|muslin|cloth/iu.test(name))return 'cloth';
  if(/دھاگ|دکھار|\bdha+ga\b|thread\s*(?:ball|roll)|\bthread\b(?!ed)/iu.test(name))return 'thread';
  if(/ٹیفلون|ٹیفلن|teflon|ptfe|t[ae]fl[ou]n/iu.test(name))return 'teflon';
  if(/کنکشن|کنیکشن|connection\s*pipe/iu.test(name))return 'connection_pipe';
  if(/brass\s*nipple|b[ix]*al[ -]?nipple|براس\s*نپل/iu.test(name))return 'brass_nipple';
  if(/hand(?:all|le)?[ -]*(?:cock[ -]*)?(?:valve|wall)|ہینڈل\s*والو/iu.test(name))return 'handle_valve';
  if(/آری|آر[یے]|hacksaw|saw.?blade|(?:ari|axi).?blade|blade.?\b(?:ari|axi)\b/iu.test(name))return 'saw_blade';
  if(/بلیڈ|blade/iu.test(name))return 'blade';
}
export function hardwareLabel(name:string){return labels[hardwareKind(name)??'']??name;}
export function demandRequested(message:string,task?:string){return task==='estimate'||/ایسٹیمیٹ|اسٹیمیٹ|تخمینہ|لیس|\b(?:estimate|quotation|demand|quote)\b/iu.test(message);}
export function demandDiscounts(message:string){
  const rules=categoryDiscountChoices(message);if(rules.length)return rules;
  // Specs may sit between the category and its discount (Pipe PN-16 @ 50%).
  // Pressure numbers are never interpreted as discounts without a % suffix.
  const categoryRates=(pattern:RegExp)=>[...new Set([...message.matchAll(pattern)].map(x=>Number(x[1])))];
  const pipes=categoryRates(/(?:\bpipes?\b|پائپ)(?:(?!\bfittings?\b|فٹنگ|[,،;\n]).){0,45}?(\d+(?:\.\d+)?)\s*(?:%|فیصد)/giu);
  const fittings=categoryRates(/(?:\bfittings?\b|فٹنگز?)(?:(?!\bpipes?\b|پائپ|[,،;\n]).){0,30}?(\d+(?:\.\d+)?)\s*(?:%|فیصد)/giu);
  if(pipes.length===1&&fittings.length===1&&pipes[0]!<=100&&fittings[0]!<=100)return [{match:'pipe',discount:pipes[0]!},{match:'fittings',discount:fittings[0]!}];
  const values=[...message.matchAll(/(\d+(?:\.\d+)?)\s*(?:%|فیصد)/gu)].map(x=>Number(x[1]));
  return values.length===2&&values.every(x=>x<=100)?[{match:'pipe',discount:values[0]!},{match:'fittings',discount:values[1]!}]:[];
}
export function hardwareInstructions(message:string){
  const hardwareRates:Array<{kind:typeof hardwareKinds[number];rate:number}>=[];
  const clauses=message.replace(/[۰-۹٠-٩]/g,char=>String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(char)%10)).split(/اور|،|,|\band\b|\n/iu);
  for(const clause of clauses){
    if(/نہ\s*لگا|مت\s*لگا|نہیں\s*لگا|do\s+not|don't|never|[؟?]/iu.test(clause))continue;
    // Find item boundaries before reading numbers: dimensions such as 7 inch
    // and 1/2 must never become prices, even without punctuation or currency.
    const names=[...clause.matchAll(/ململ|کپڑا|دھاگہ?|ٹیفلون(?:\s*ٹیپ)?|کنکشن\s*پائپ|آری\s*بلیڈ|براس\s*نپل|ہینڈل\s*والو|بلیڈ|\b(?:malmal|cloth|thread|tefl[oou]*n(?:\s*tape)?|co+n[en]*ction\s*pipe|connection\s*pipe|ari\s*blade|saw\s*blade|(?:brass\s*)?nipple|handle\s*valve|blade|bale)\b/giu)];
    for(const [index,name] of names.entries()){
      const alias=name[0].replace(/\bbale\b/iu,'blade').replace(/co+n[en]*ction/iu,'connection').replace(/tefl[oou]*n/iu,'teflon').replace(/^nipple$/iu,'brass nipple');
      const kind=hardwareKind(alias);if(!kind)continue;
      const tail=clause.slice(name.index!+name[0].length,names[index+1]?.index??clause.length)
        .replace(/^\s*(?:\d+(?:\/\d+|\.\d+)?\s*(?:inch(?:es)?\b|ft\b|feet\b|["″]|انچ)|\d+\/\d+\s*(?:inch\b|["″]|انچ)?)\s*/iu,'');
      const match=tail.match(/^\s*(?:کا|کی|کو|پر|at|@|[:=])?\s*(\d+(?:\.\d+)?)\s*(?:(?:روپے?|روپیہ|rs\.?|pkr)\s*)?(?:(?:fi|per|فی)\s*(?:gaz|yard|گز|pcs?|عدد)\s*)?(?:(?:لگا\s*(?:دو|دیں)|ہے|ہیں|apply|please)\s*)?[۔.;!\s]*$/iu);
      if(match)hardwareRates.push({kind,rate:Number(match[1])});
    }
  }
  const catalog=/(?:سافٹ\s*ویئر|سافٹویئر|software|hardware|ہارڈویئر).{0,30}(?:ریٹ|نرخ|rates?|prices?).{0,20}(?:لگا|استعمال|use|apply)|(?:use|apply).{0,20}(?:software|hardware).{0,20}(?:rates?|prices?)/iu.test(message);
  // Conflicting repeated prices need clarification rather than last-write wins.
  const unique=hardwareRates.filter((row,index,rows)=>rows.findIndex(other=>other.kind===row.kind)===index&&rows.every(other=>other.kind!==row.kind||other.rate===row.rate));
  return {hardwareRates:unique,...(catalog&&!/نہ\s*لگا|مت\s*لگا|نہیں\s*لگا|do\s+not|don't|never|[؟?]/iu.test(message)?{hardwarePricing:'catalog' as const}:{})};
}
export function hardwarePrompt(lines:any[],catalogApproved=false){
  const rows=lines.filter(x=>x.pending&&x.hardware);
  if(!rows.length)return '';
  return (catalogApproved?'جناب، آپ کی اجازت سے عام ہارڈویئر نرخ تلاش کیے؛ ان متفرق آئٹمز کا درست فعال نرخ نہیں ملا:\n':'جناب، مندرجہ ذیل متفرق آئٹمز ڈیورا میکس کی لسٹ میں شامل نہیں ہیں:\n')+rows.map((x,i)=>`${i+1}. ${hardwareLabel(x.productName)}${x.size?' '+x.size:''}: ${x.quantity} ${hardwareKind(x.productName)==='thread'?'گولے':x.unit==='gaz'?'گز':x.unit==='pcs'?'عدد':x.unit} — ریٹ مطلوب`).join('\n')+(catalogApproved?'\nان کا اپنا نرخ بتا دیں یا انہیں ابھی ریٹ مطلوب کے ساتھ محفوظ رکھیں۔':'\nکیا ان پر ہمارے سافٹ ویئر میں موجود عام ہارڈویئر ریٹ لگا دوں، یا آپ ان کی قیمت بتانا پسند کریں گے؟');
}
