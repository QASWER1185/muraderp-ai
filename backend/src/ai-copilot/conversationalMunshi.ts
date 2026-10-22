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

export function munshiErrorMessage(code:string,message:string):string {
  if(/[\u0600-\u06ff]/u.test(message))return message;
  const messages:Record<string,string>={
    AI_PROVIDER_BAD_REQUEST:"جناب، تصویر کے لیے AI کی درخواست کا فارمیٹ قبول نہیں ہوا۔ تصویر JPEG یا PNG میں دوبارہ بھیج دیں؛ مسئلہ برقرار رہے تو منتخب ماڈل کی ترتیبات دیکھ لیں۔",
    AI_NOT_CONFIGURED:"جناب، Copilot کی ترتیبات میں Gemini کی API کلید درج کر دیں تاکہ پرچی پڑھ سکوں۔",
    AI_API_KEY_REJECTED:"جناب، Gemini کی API کلید قبول نہیں ہوئی؛ Copilot کی ترتیبات میں درست کلید درج کر دیں۔",
    AI_PROVIDER_RATE_LIMITED:"جناب، AI کی عارضی حد پوری ہو گئی ہے۔ گفتگو کی تفصیل برقرار ہے؛ کچھ دیر بعد دوبارہ کوشش کریں۔",
    AI_PROVIDER_PAYMENT_REQUIRED:"جناب، AI فراہم کنندہ کے اکاؤنٹ میں بلنگ یا کریڈٹ درکار ہے؛ اس کی ترتیبات دیکھ لیں۔",
    AI_MODEL_UNAVAILABLE:"جناب، منتخب AI ماڈل دستیاب نہیں؛ Copilot کی ماڈل ترتیبات درست کر دیں۔",
    AI_PROVIDER_UNAVAILABLE:"جناب، AI سے رابطہ نہیں ہو سکا۔ آپ کی گفتگو برقرار ہے؛ دوبارہ کوشش کریں۔",
    CONVERSATION_CONTEXT_INVALID:"جناب، اس گفتگو کی مدت ختم ہو گئی ہے۔ گاہک کا نام اور مطلوبہ سامان دوبارہ بتا دیں۔",
    VALIDATION_ERROR:"جناب، درخواست کی چند تفصیلات درست نہیں۔ گاہک کا نام، مقدار اور منسلک فائل دوبارہ دیکھ لیں۔",
    INVALID_MEDIA:"جناب، یہ فائل واضح طور پر نہیں پڑھی جا سکی۔ JPEG، PNG، WebP یا PDF میں دوبارہ بھیج دیں۔",
    AI_INPUT_UNSUPPORTED:"جناب، تصویر JPEG، PNG، WebP یا PDF میں بھیج دیں۔",
    AI_INVALID_OUTPUT:"جناب، AI سے مکمل قابلِ استعمال تفصیل نہیں آئی۔ اصل پرچی دوبارہ بھیج دیں؛ کوئی مقدار یا نرخ خود سے شامل نہیں کیا گیا۔",
    AI_INCOMPLETE:"جناب، پرچی کی پوری تفصیل نہیں پڑھی جا سکی۔ واضح تصویر یا چھوٹے حصوں میں دوبارہ بھیج دیں۔",
    MEDIA_TOO_LARGE:"جناب، تمام فائلوں کا مجموعی حجم 8 MB تک رکھیں۔",
    MEDIA_DIMENSIONS_LIMIT:"جناب، تصویر کا سائز 16 megapixels تک کر کے دوبارہ بھیج دیں۔",
    PDF_PAGE_LIMIT:"جناب، پرچی کے PDF میں زیادہ سے زیادہ 10 صفحات رکھیں؛ بڑی ریٹ لسٹ الگ بھیجیں۔",
    DISCOUNT_BELOW_COST:"جناب، یہ رعایت خرید لاگت سے کم نرخ بنا رہی ہے۔ مناسب رعایت بتا دیں؛ نقصان والی قیمت شامل نہیں کی گئی۔",
    PURCHASE_BASELINE_REQUIRED:"جناب، اس آئٹم کی خرید لاگت کی تصدیق درکار ہے تاکہ رعایت کے بعد نقصان نہ ہو۔",
    ERP_APPROVAL_CHANGED:"جناب، پری ویو کے بعد نرخ یا تفصیل بدل گئی ہے۔ تازہ پری ویو دیکھ کر دوبارہ منظوری دے دیں۔",
  };
  return messages[code]??"جناب، اس تفصیل پر کام مکمل نہیں ہو سکا۔ مطلوبہ گاہک، برانڈ، سائز یا مقدار واضح کر دیں؛ موجودہ گفتگو برقرار ہے۔";
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
