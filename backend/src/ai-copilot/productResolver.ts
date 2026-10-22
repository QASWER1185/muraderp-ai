/** Explicit brand choices are restrictions, including common spoken spellings. */
export function canonicalBrand(value: string): string {
  const normalized=value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g," ");
  if (/^(?:d[ue]ra\s*max|ڈیورا میکس|ڈورا میکس|ڈیرا میکس|دورا میکس)$/u.test(normalized)) return "Dura Max";
  if(/^(?:popular|پاپولر)$/u.test(normalized))return "Popular";
  if(/^(?:turk\s*plast|ترک\s*پلاسٹ)$/u.test(normalized))return "Turk Plast";
  if(/^(?:he\s*china|ایچ\s*ای\s*چائنا)$/u.test(normalized))return "HE China";
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

function specifications(value:string):string[] {
  const text=value.normalize("NFKC").toLowerCase().replace(/[۰-۹٠-٩]/g,char=>String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(char)%10));
  const decimal=(value:string)=>{
    const parts=value.trim().split(/[-\s]+/),last=parts.pop()!;
    const fraction=last.split("/").map(Number);
    return parts.reduce((sum,part)=>sum+Number(part),0)+(fraction.length===2?fraction[0]!/fraction[1]!:Number(last));
  };
  const sizes=[...text.matchAll(/(\d+(?:[-\s]+\d+\/\d+|\/\d+|\.\d+)?)\s*(mm\b|millimeters?\b|inch(?:es)?\b|in\b|["″]|انچ)/gu)]
    .map(match=>(/^(?:mm|millimeter)/.test(match[2]!)?"mm:":"inch:")+decimal(match[1]!));
  for(const match of text.matchAll(/\b(pn|sch(?:edule)?)\s*[-:]?\s*(\d+)\b/gu))sizes.push((match[1]==="pn"?"pn:":"schedule:")+Number(match[2]));
  for(const match of text.matchAll(/\bclass\s*['"]?([a-z0-9]+)\b/gu))sizes.push("class:"+match[1]);
  return sizes;
}

/** Explicit dimensions/pressure/class are restrictions, never fuzzy preferences. */
export function matchesProductSpecification(query:string,candidate:string):boolean {
  const actual=new Set(specifications(candidate));
  return specifications(query).every(spec=>actual.has(spec));
}
