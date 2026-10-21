/** Search normalization only; original slip wording remains available for review. */
export function canonicalSlipWords(value:string):string {
  return value.normalize("NFKC").replace(/\p{M}/gu,"").replace(/ایلبو|البو|\belbo\b/giu,"Elbow")
    .replace(/ساکٹ|سوکٹ/gu,"Socket").replace(/\btee\b|ٹی جوائنٹ/giu,"Tee")
    .replace(/یو\s*پی\s*وی\s*سی/gu,"U-PVC").replace(/پی\s*پی\s*آر\s*سی/gu,"PPR-C")
    .replace(/\bdera\s*max\b|(?:ڈیورا|ڈورا|ڈیرا|دورا)\s*میکس/giu,"Dura Max")
    .replace(/پاپولر/gu,"Popular").replace(/ترک\s*پلاسٹ/gu,"Turk Plast").replace(/ایچ\s*ای\s*چائنا/gu,"HE China")
    .replace(/پائپ/gu,"Pipe").replace(/ٹیفلون/gu,"Teflon").replace(/سلوشن/gu,"Solvent Solution")
    .replace(/یونین/gu,"Union").replace(/پلگ/gu,"Plug").replace(/والو/gu,"Valve")
    .replace(/فیمیل/gu,"Female").replace(/ایڈاپٹر/gu,"Adapter").replace(/میڈیم/gu,"Medium").replace(/کنڈوئٹ/gu,"Conduit");
}
export function canonicalUnit(value:string):string {
  const unit=value.trim().toLowerCase();
  if(/^(?:pcs?|pieces?|عدد|پی سیز)$/u.test(unit))return "pcs";
  if(/^(?:kg|kgs|kilograms?|کلو|کلوگرام)$/u.test(unit))return "kg";
  if(/^(?:length|lengths|pipe length|لمبائی)$/u.test(unit))return "length";
  return unit;
}
export function landedCost(input:{quantity:number;baseUnitCost:number;carriage:number;unloadingPerUnit:number}) {
  if(input.quantity<=0 || [input.quantity,input.baseUnitCost,input.carriage,input.unloadingPerUnit].some(value=>!Number.isFinite(value)||value<0))throw new Error("Invalid landed cost inputs");
  const total=input.quantity*(input.baseUnitCost+input.unloadingPerUnit)+input.carriage;
  return {total,unitCost:total/input.quantity,base:input.quantity*input.baseUnitCost,carriage:input.carriage,unloading:input.quantity*input.unloadingPerUnit};
}
export function rateFreeChallan(input:{number:string;customer:string;site?:string;lines:Array<{name:string;size?:string;quantity:number;unit:string}>}) {
  return {number:input.number,customer:input.customer,...(input.site?{site:input.site}:{}),
    lines:input.lines.map(line=>({checked:false,name:line.name,...(line.size?{size:line.size}:{}),quantity:line.quantity,unit:line.unit})),
    text:[ "ڈسپیچ چلّان "+input.number,input.customer,input.site??"",...input.lines.map(line=>"▢ "+line.name+(line.size?" "+line.size:"")+" — "+line.quantity+" "+line.unit)].filter(Boolean).join("\n")};
}
