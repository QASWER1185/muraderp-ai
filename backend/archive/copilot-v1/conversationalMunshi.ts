import {normalizeVoiceChoices} from '../../src/ai-copilot/voice-choices.js';
/** Search normalization only; original slip wording remains available for review. */
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

export function munshiErrorMessage(code:string,message:string,step="درخواست کی تفصیل تیار کرتے وقت"):string {
  const opaque=/اس مرحلے کی تصدیق نہیں ہو سکی|یہ کام مکمل نہیں ہو سکا|مطلوبہ تفصیل واضح کریں|یہ نہیں ہو سکتا/u;
  if(["ERP_ACTION_CLARIFICATION","DRAFT_CONTEXT_REQUIRED","BUSINESS_CONTEXT_REQUIRED","RETURN_INVOICE_CHOICE_REQUIRED"].includes(code) && /[\u0600-\u06ff]/u.test(message) && !opaque.test(message))return `جناب، ${step} یہ بات سامنے آئی: ${message.replace(/^جناب[،\s]*/u,"")}`;
  const messages:Record<string,string>={
    AI_PROVIDER_BAD_REQUEST:"جناب، AI نے درخواست کا فارمیٹ یا منتخب ماڈل کی ترتیبات قبول نہیں کیں۔ گفتگو برقرار ہے؛ دوبارہ کوشش کریں یا Copilot کی ماڈل ترتیبات دیکھ لیں۔",
    AI_NOT_CONFIGURED:"جناب، Copilot کی ترتیبات میں Gemini کی API کلید درج کر دیں تاکہ پرچی پڑھ سکوں۔",
    AI_API_KEY_REJECTED:"جناب، Gemini کی API کلید قبول نہیں ہوئی؛ Copilot کی ترتیبات میں درست کلید درج کر دیں۔",
    AI_PROVIDER_RATE_LIMITED:"جناب، AI کی عارضی حد پوری ہو گئی ہے۔ گفتگو کی تفصیل برقرار ہے؛ کچھ دیر بعد دوبارہ کوشش کریں۔",
    AI_PROVIDER_PAYMENT_REQUIRED:"جناب، AI فراہم کنندہ کے اکاؤنٹ میں بلنگ یا کریڈٹ درکار ہے؛ اس کی ترتیبات دیکھ لیں۔",
    AI_MODEL_UNAVAILABLE:"جناب، منتخب AI ماڈل دستیاب نہیں؛ Copilot کی ماڈل ترتیبات درست کر دیں۔",
    AI_PROVIDER_UNAVAILABLE:"جناب، AI سے رابطہ نہیں ہو سکا۔ آپ کی گفتگو برقرار ہے؛ دوبارہ کوشش کریں۔",
    AI_PROVIDER_ERROR:"جناب، آپ کی ہدایت پر اگلا قدم طے کرتے وقت AI فراہم کنندہ نے خرابی واپس کی ہے۔ گاہک اور موجودہ مسودے کے انتخاب برقرار ہیں؛ اسی گفتگو میں دوبارہ کوشش کریں یا مطلوبہ تبدیلی بتا دیں۔",
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
  const blockers:Record<string,string>={
    ERP_READ_FAILED:"ERP کے اصل ریکارڈ پڑھنے کا رابطہ دستیاب نہیں۔ رابطہ بحال ہونے پر یہی درخواست دوبارہ بھیجیں؛ رقم یا اسٹاک کا اندازہ نہیں لگاؤں گا۔",
    CATALOG_NO_PRICED_ITEMS:"تصویر میں قیمتوں والی کوئی قابلِ مطالعہ کیٹلاگ سطر نہیں ملی۔ اگر یہ مقداروں کی پرچی ہے تو ایسٹیمیٹ منتخب کریں؛ نئی ریٹ لسٹ درج کرنے کے لیے قیمتوں والا صفحہ بھیجیں۔",
    SLIP_EXTRACTION_FAILED:"منسلک پرچیوں کی لکھائی نہیں پڑھی جا سکی۔ واضح تصاویر یا پڑھی ہوئی سطروں کا متن بھیجیں؛ سائز، مقدار یا نرخ خود سے شامل نہیں کروں گا۔",
    RETURN_HISTORY_REQUIRED:"اس گاہک اور آئٹم کی اس برانچ میں کوئی پوسٹ شدہ فروخت نہیں ملی۔ اصل بل کا نمبر یا درست گاہک بتا دیں تاکہ اسی تاریخی نرخ پر واپسی تیار ہو۔",
    CUSTOMER_MEMORY_UNAVAILABLE:"گاہک کی اصل فروخت اور رعایتوں کی تاریخ نہیں پڑھی جا سکی۔ رابطہ بحال ہونے پر اسی گاہک کا کھاتہ دوبارہ پڑھیں؛ پرانا نرخ خود سے نہیں لگاؤں گا۔",
    PURCHASE_MEMORY_UNAVAILABLE:"اصل خرید لاگت کا ریکارڈ نہیں پڑھا جا سکا۔ خریداری کے ریکارڈ کی پڑتال کریں یا تصدیق شدہ لاگت بتا دیں۔",
    COPILOT_VERIFICATION_FAILED:"منظور شدہ کارروائی کا نتیجہ اصل ERP ریکارڈ سے ابھی نہیں مل سکا۔ اسی منظوری کی شناخت سے دوبارہ پڑتال کریں؛ بل یا وصولی دوبارہ نہ بنائیں۔",
    ERP_TRANSACTION_REJECTED:"ERP نے لین دین قبول نہیں کیا۔ ریکارڈ کی تازہ حالت اور مطلوبہ مقدار دوبارہ دیکھ کر نیا پری ویو تیار کریں۔",
    ERP_ACTION_UNVERIFIED:"محفوظ کرنے کی درخواست کے بعد اصل ERP ریکارڈ کی پڑتال مکمل نہیں ہوئی۔ پہلے ریکارڈ کی حالت دیکھیں؛ اسی منظوری کی شناخت سے دوبارہ پڑتال کریں تاکہ دہرا اندراج نہ ہو۔",
    INVALID_COPILOT_TOOL_INPUT:"AI کے بھیجے ہوئے خانوں کا فارمیٹ ERP کے مطابق نہیں۔ گاہک، آئٹم اور مقدار کے ساتھ ہدایت دوبارہ دیں تاکہ درست پری ویو تیار ہو۔",
    CONVERSATION_STATE_LIMIT:"اس گفتگو کے محفوظ سیاق کی گنجائش پوری ہے۔ موجودہ مسودے کا پری ویو دیکھیں یا اگلے کام کے لیے نئی گفتگو شروع کریں۔",
    AGENT_TIMEOUT:"AI یا ERP کے جواب کی مقررہ مدت پوری ہو گئی۔ اسی گفتگو میں دوبارہ کوشش کریں؛ زیرِ التوا ریکارڈ کی حالت پہلے پڑتال ہو گی۔",
    AGENT_EMPTY:"جواب مکمل نہیں ہو سکا؛ گفتگو برقرار ہے۔ دوبارہ کوشش کر لیں۔",
    AGENT_LIMIT:"AI ایک ہی مرحلے پر رک گیا یا اس درخواست کے مراحل کی حد پوری ہو گئی۔ باقی کام ایک قدم میں بتا دیں تاکہ اسی گفتگو سے آگے بڑھ سکوں۔",
    UNEXPECTED_TOOL_ERROR:"ERP کے اس قدم سے قابلِ اعتماد جواب نہیں ملا۔ اسی قدم کی دوبارہ پڑتال کریں یا مطلوبہ ریکارڈ اور تبدیلی بتا دیں؛ غیر مصدقہ رقم کو حتمی نہیں دکھاؤں گا۔",
  };
  if(messages[code])return messages[code];
  if(blockers[code])return `جناب، ${step}: ${blockers[code]}`;
  // Only expose known business clarification text. Database/provider messages
  // can contain credentials, SQL or other tenants' data and stay in server logs.
  if(["ERP_ACTION_CLARIFICATION","DRAFT_CONTEXT_REQUIRED","BUSINESS_CONTEXT_REQUIRED"].includes(code)) {
    if(/warehouse/i.test(message))return `جناب، ${step} گودام کا انتخاب درکار ہے۔ اس بل یا واپسی کے لیے گودام کا نام بتا دیں۔`;
    if(/customer/i.test(message))return `جناب، ${step} گاہک کا ریکارڈ واضح نہیں۔ درست نام یا علاقہ بتا دیں تاکہ اسی مسودے پر کام جاری رکھوں۔`;
    if(/stock/i.test(message))return `جناب، ${step} مطلوبہ مقدار دستیاب اسٹاک سے زیادہ ہے۔ مقدار کم کریں یا پہلے نئی وصولی درج کر کے یہی بل دوبارہ تیار کریں۔`;
    if(/cost|unitCost/i.test(message))return `جناب، ${step} خرید لاگت کی تصدیق درکار ہے۔ تصدیق شدہ فی یونٹ لاگت بتائیں یا خریداری کا ریکارڈ درست کریں۔`;
    if(/rate|price|catalog/i.test(message))return `جناب، ${step} فعال کیٹلاگ نرخ اور مطلوبہ قیمت میں مطابقت نہیں ملی۔ درست ریٹ لسٹ منتخب کریں یا وجہ کے ساتھ نرخ کی تبدیلی کا پری ویو تیار کریں۔`;
    if(/quantity/i.test(message))return `جناب، ${step} مقدار اصل بل کی قابلِ واپسی مقدار سے زیادہ ہے۔ اصل بل منتخب کریں یا واپسی کی مقدار کم کر دیں۔`;
    if(/allocation|payment|paid amount/i.test(message))return `جناب، ${step} وصولی اور بلوں کی مختص رقم میں فرق ہے۔ وصولی کی رقم اور ہر بل کا حصہ واضح کر دیں۔`;
    return `جناب، ${step} منتخب ریکارڈ یا اس کی مطلوبہ تفصیل موجودہ ERP ریکارڈ سے نہیں ملی۔ گاہک، آئٹم یا اصل بل کا درست حوالہ بتا دیں۔`;
  }
  return `جناب، ${step} غیر متوقع رکاوٹ آئی (حوالہ: ${/^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:"UNEXPECTED_ERROR"})۔ اسی قدم کی دوبارہ پڑتال کریں یا ریکارڈ کا حوالہ اور مطلوبہ تبدیلی بتا دیں؛ اصل ریکارڈ دیکھے بغیر کامیابی ظاہر نہیں کروں گا۔`;
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
