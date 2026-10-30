import {normalizeVoiceChoices} from '../voice-choices.js';

export function canonicalSlipWords(value:string):string {
  return normalizeVoiceChoices(value).replace(/\p{M}/gu,"").replace(/[۰-۹٠-٩]/g,char=>String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(char)%10))
    .replace(/پونا\s*انچ|پون\s*انچ/gu,"3/4 inch").replace(/ایک\s*انچ/gu,"1 inch").replace(/چار\s*انچ/gu,"4 inch")
    .replace(/ایم\s*ایم/gu,"mm").replace(/ایلبو|البو|ایلو|\belbo\b/giu,"Elbow")
    .replace(/پی\s*ٹر(?:یپ|پ)/gu,"P-Trap").replace(/گیٹ/gu,"Gate")
    .replace(/ٹی\s*ساکٹ|ٹی\s*جوائنٹ|(?:^|\s)ٹی(?=\s|$)/gu," Tee ")
    .replace(/ساکٹ|سوکٹ/gu,"Socket").replace(/\btee\b/giu,"Tee")
    .replace(/\by[ -]*tee\b/giu,'Yee').replace(/\breduce\b/giu,'Reducing')
    .replace(/\bcross[ -]*bridge\b/giu,'Over Cross').replace(/\bgate[ -]*(?:wall|valve)\b/giu,'Gate Valve')
    .replace(/\bcross[ -]*over\b|\bover[ -]*cross\b/giu,'Over Cross')
    .replace(/(?:یو\s*)?پی\s*وی\s*سی|\b(?:u\s*-?\s*)?pvc\b/giu,"U-PVC").replace(/پی\s*پی\s*آر\s*سی|\bpprc\b/giu,"PPR-C")
    .replace(/ڈگری|\bdegrees?\b/giu,"°").replace(/انچ/gu,"inch")
    .replace(/\b(elbow|bend)\s+(45|90)(?!\d)(?!\s*°)/giu,"$1 $2°")
    .replace(/\bdera\s*max\b|(?:ڈیورا|ڈورا|ڈیرا|دورا)\s*میکس/giu,"Dura Max")
    .replace(/پاپولر/gu,"Popular").replace(/ترک\s*پلاسٹ/gu,"Turk Plast").replace(/ایچ\s*ای\s*چائنا/gu,"HE China")
    .replace(/پائپ/gu,"Pipe").replace(/ٹیفلون/gu,"Teflon").replace(/سلوشن/gu,"Solvent Solution")
    .replace(/\bsolvent\s+solution\b/giu,"Solvent")
    .replace(/\b(?:solutation|solution|solituion|solutuion|selitium)\b/giu,'Solvent')
    .replace(/(\d)\s*(?:g|gm|gms|grams?)\b/giu,"$1 g")
    .replace(/یونین/gu,"Union").replace(/پلگ/gu,"Plug").replace(/والو/gu,"Valve")
    .replace(/فیمیل|مادہ/gu,"Female").replace(/نر/gu,"Male").replace(/\bMT\b/giu,"Male").replace(/ایڈاپٹر/gu,"Adapter").replace(/میڈیم/gu,"Medium").replace(/کنڈوئٹ/gu,"Conduit").replace(/\s+/g," ").trim();
}
export function canonicalUnit(value:string):string {
  const unit=value.trim().toLowerCase();
  if(/^(?:pcs?|pieces?|عدد|پی سیز)$/u.test(unit))return "pcs";
  if(/^(?:kg|kgs|kilograms?|کلو|کلوگرام)$/u.test(unit))return "kg";
  if(/^(?:gaz|guz|گز)$/u.test(unit))return "gaz";
  if(/^(?:length|lengths|pipe length|لمبائی)$/u.test(unit))return "length";
  return unit;
}
