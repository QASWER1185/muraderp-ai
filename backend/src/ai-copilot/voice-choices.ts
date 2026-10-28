/** Normalize spoken business choices only; quantities and extracted rows stay intact. */
export function normalizeVoiceChoices(value:string):string {
  return value.normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g,c=>String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(c)%10))
    .replace(/ویڈیو\s*ریمیکس|ڈیورم\s*ایکس|ڈیورمیکس|ڈورامیکس|بیورو\s*میکس/gu,'Dura Max')
    .replace(/پی\s*پی\s*[اآ]ر\s*سی\s*(?:پائی|فائو)?/gu,'PPR-C ')
    .replace(/پی\s*(?:ایم|این)\s*16|پی\s*این\s*س|پیر\s*س/gu,'PN-16')
    .replace(/یو\s*پی\s*(?:وی\s*)?سی\s*پائپ\s*میڈیم/gu,'U-PVC Pipe Medium')
    .replace(/میڈیم\s*(?:Dura Max|ڈیورمیکس)/giu,'Dura Max Medium')
    .replace(/(\d+(?:\.\d+)?)\s*(?:پرسنٹ|پر\s*سنٹ|سنٹ|percent\b)/giu,'$1%');
}

export function cleanCustomerName(value:string):string|undefined {
  const name=value.replace(/^(?:پہلے\s*حصے\s*میں\s*موجود\s*)?(?:کسٹمر|گاہک)\s*(?:کا\s*نام\s*)?/u,'').trim();
  if(!name||name.length>70||name.split(/\s+/u).length>6||/[\d%:]/u.test(name)||
    /بتا\s*دیا|بتا\s*چکا|ایڈ\s*کریں|نظر\s*انداز|جو\s*میں|نام\s*بتایا|پرچی|آپ|\bاپ\b|کے\s*کھاتے|\b(?:ignore|previous|customer|estimate|already|told|add|create)\b|(?:^|\s)(?:ہے|ہیں|اس|اسے|کو|کر|کریں|دیں)(?:\s|$)/iu.test(name))return undefined;
  return name;
}

export function customerPhoneticQuery(value:string):string {
  return value.normalize('NFKC').replace(/کسر\s*حسین|کسور\s*حسین|قصور\s*حسین|قاسور\s*حسین/gu,'QASWER HUSSAIN').trim();
}
