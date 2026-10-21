/** Explicit brand choices are restrictions, including common spoken spellings. */
export function canonicalBrand(value: string): string {
  const normalized=value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g," ");
  if (/^(?:d[ue]ra\s*max|ڈیورا میکس|ڈورا میکس|ڈیرا میکس|دورا میکس)$/u.test(normalized)) return "Dura Max";
  return normalized;
}
export function explicitBrand(value: string): string | undefined {
  const brands=brandsInText(value);
  return brands.length===1?brands[0]:undefined;
}
export function brandsInText(value:string):string[] {
  return [
    {name:"Dura Max",pattern:/\b(?:dura|dera)\s*max\b|(?:ڈیورا|ڈورا|ڈیرا|دورا)\s*میکس/iu},
    {name:"Popular",pattern:/\bpopular\b|پاپولر/iu},
    {name:"Turk Plast",pattern:/\bturk\s*plast\b|ترک\s*پلاسٹ/iu},
    {name:"HE China",pattern:/\bhe\s*china\b|ایچ\s*ای\s*چائنا/iu},
  ].filter(brand=>brand.pattern.test(value)).map(brand=>brand.name);
}
export function sameBrand(actual: string | null | undefined, expected: string): boolean {
  return !!actual && canonicalBrand(actual)===canonicalBrand(expected);
}
