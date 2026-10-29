/** V2 failures never invoke a legacy agent or expose upstream payloads. */
export function v2ErrorMessage(code:string):string {
  if(['UNAUTHORIZED','FORBIDDEN','ACCESS_DENIED','AI_API_KEY_REJECTED'].includes(code))
    return 'رسائی کی تصدیق نہیں ہو سکی؛ اپنا سائن اِن یا Gemini کی اجازت چیک کر لیں۔';
  if(code==='AI_NOT_CONFIGURED')return 'Gemini کی key ابھی ترتیب نہیں دی گئی؛ Copilot کی settings یا سرور کی ترتیب مکمل کر لیں۔';
  if(['ERP_NOT_CONFIGURED','COPILOT_NOT_CONFIGURED','V2_STORE_UNAVAILABLE','V2_MEMORY_UNAVAILABLE'].includes(code))
    return 'کاروباری ریکارڈ سے رابطہ مکمل نہیں ہو سکا؛ اس جواب سے کسی رقم یا محفوظ کارروائی کی تصدیق نہیں ہوئی۔';
  if(code==='AI_PROVIDER_RATE_LIMITED')return 'Gemini کی عارضی حد پوری ہو گئی ہے؛ تھوڑی دیر بعد دوبارہ کوشش کر لیں۔';
  if(code==='AI_MODEL_UNAVAILABLE')return 'منتخب Gemini ماڈل دستیاب نہیں؛ سرور کی ماڈل ترتیب چیک کر لیں۔';
  if(['VALIDATION_ERROR','V2_INPUT_INVALID'].includes(code))return 'درخواست کی کچھ تفصیل درست یا مکمل کر دیں تاکہ میں آگے بڑھ سکوں۔';
  return 'اس وقت جواب مکمل نہیں ہو سکا۔ کوئی غیر مصدقہ رقم یا نئی محفوظ کارروائی فرض نہ کریں؛ دوبارہ کوشش کر لیں۔';
}
