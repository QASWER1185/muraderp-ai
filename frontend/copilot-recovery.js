/** Safe browser recovery; raw SQL/provider bodies never belong in chat. */
export function copilotRecoveryMessage(error, step = "آپ کی درخواست پر کام کرتے وقت") {
  const code=error?.code;
  const reasons={
    ERP_READ_FAILED:"اصل ERP ریکارڈ پڑھنے کا رابطہ دستیاب نہیں۔ رابطہ بحال ہونے پر اسی گفتگو میں دوبارہ پڑتال کریں۔",
    ERP_TRANSACTION_REJECTED:"ERP نے یہ لین دین قبول نہیں کیا۔ تازہ ریکارڈ اور مقدار دیکھ کر نیا پری ویو تیار کریں۔",
    ERP_APPROVAL_CHANGED:"منظوری کے بعد نرخ یا ریکارڈ بدل گیا ہے۔ تازہ پری ویو دیکھ کر دوبارہ منظوری دیں۔",
    ERP_ACTION_UNVERIFIED:"منظور شدہ اندراج کی اصل ریکارڈ سے پڑتال باقی ہے۔ پہلے ریکارڈ کی حالت معلوم کریں تاکہ وصولی یا بل دوبارہ درج نہ ہو۔",
    AI_NOT_CONFIGURED:"AI کی کلید موجود نہیں۔ Copilot کی API ترتیبات میں کلید درج کریں۔",
    AI_MODEL_UNAVAILABLE:"منتخب AI ماڈل دستیاب نہیں۔ ماڈل کی ترتیبات درست کریں۔",
    AI_PROVIDER_PAYMENT_REQUIRED:"AI فراہم کنندہ نے بلنگ یا کریڈٹ مانگا ہے۔ اس اکاؤنٹ کی بلنگ درست کریں۔",
  };
  if(reasons[code])return `جناب، ${step}: ${reasons[code]}`;
  if(error?.status===401)return "جناب، ERP سیشن کی مدت ختم ہو گئی ہے۔ دوبارہ لاگ اِن کر کے اسی ورک اسپیس میں کام جاری رکھیں۔";
  if(error?.status===403)return "جناب، فعال صارف کو اس ریکارڈ یا کارروائی کی اجازت نہیں۔ درست ورک اسپیس منتخب کریں یا مالک سے مطلوبہ اجازت دلوائیں۔";
  if(error?.name==="AbortError"||error?.name==="TimeoutError")return `جناب، ${step} جواب کی مقررہ مدت پوری ہو گئی۔ اسی درخواست کی دوبارہ پڑتال کریں؛ محفوظ ہونے کی حالت معلوم کیے بغیر بل یا وصولی دوبارہ نہ بنائیں۔`;
  if(error instanceof TypeError||/fetch|network|offline/iu.test(error?.message??""))return `جناب، ${step} سرور سے رابطہ ٹوٹ گیا۔ انٹرنیٹ بحال کر کے اسی گفتگو میں دوبارہ کوشش کریں؛ منظور شدہ ریکارڈ کی حالت پہلے دیکھیں۔`;
  return `جناب، ${step} سرور سے متوقع جواب نہیں ملا${/^[A-Z][A-Z0-9_]{0,79}$/.test(code??"")?` (حوالہ: ${code})`:""}۔ مطلوبہ ریکارڈ اور تبدیلی بتائیں یا اسی قدم کی دوبارہ پڑتال کریں۔`;
}
