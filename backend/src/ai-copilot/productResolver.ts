/** Explicit brand choices are restrictions, including common spoken spellings. */
export function canonicalBrand(value: string): string {
  const normalized=value.normalize("NFKC").trim().toLowerCase().replace(/[\s_-]+/g," ");
  if (/^(?:d[ue]ra\s*max|(?:ڈیورا|ڈورا|ڈیرا|دورا)\s*میکس)$/u.test(normalized)) return "Dura Max";
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

function specifications(value:string,catalog=false):string[] {
  const text=value.normalize("NFKC").toLowerCase().replace(/[۰-۹٠-٩]/g,char=>String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(char)%10));
  const decimal=(value:string)=>{
    const parts=value.trim().split(/[-\s]+/),last=parts.pop()!;
    const fraction=last.split("/").map(Number);
    return parts.reduce((sum,part)=>sum+Number(part),0)+(fraction.length===2?fraction[0]!/fraction[1]!:Number(last));
  };
  const sizes=[...text.matchAll(/(\d+(?:[-\s]+\d+\/\d+|\/\d+|\.\d+)?)\s*(mm\b|millimeters?\b|inch(?:es)?\b|in\b|["″]|انچ)/gu)]
    .map(match=>(/^(?:mm|millimeter)/.test(match[2]!)?"mm:":"inch:")+decimal(match[1]!));
  for(const pair of text.matchAll(/(\d+(?:\/\d+|\.\d+)?)\s*[x×*]\s*(\d+(?:\/\d+|\.\d+)?)\s*(mm\b|inch\b|["″])/gu))
    sizes.push((pair[3]==="mm"?"mm:":"inch:")+decimal(pair[1]!));
  for(const match of text.matchAll(/\b(pn|sch(?:edule)?)\s*[-:]?\s*(\d+)\b/gu))sizes.push((match[1]==="pn"?"pn:":"schedule:")+Number(match[2]));
  for(const match of text.matchAll(/\bclass\s*['"]?([a-z0-9]+)\b/gu))sizes.push("class:"+match[1]);
  for(const match of text.matchAll(/(\d{2,3})\s*(?:°|degrees?\b|ڈگری)/gu))sizes.push("angle:"+Number(match[1]));
  for(const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|gm|gms|grams?|گرام)\b/gu))sizes.push("grams:"+Number(match[1]));
  for(const variant of ["medium","single","double","plastic","metal","fancy","female","male","threaded","plain"])if(new RegExp("\\b"+variant+"\\b","u").test(text))sizes.push("variant:"+variant);
  if(/\b(?:female|male)\b/.test(text))sizes.push("variant:threaded");
  if(catalog&&/\b(?:elbow|tee|socket|adapter|union)\b/.test(text)&&!/\b(?:female|male|threaded)\b/.test(text))sizes.push("variant:plain");
  return sizes;
}

/** The merchant's named Dura variants are defaults for unspecified variants;
 * they restrict catalog search, never replace authoritative stored prices. */
export function canonicalCatalogQuery(value:string,brand?:string):string {
  if(!sameBrand(brand??explicitBrand(value),"Dura Max"))return value;
  let query=value;
  if(/\bu[\s-]*pvc\b/i.test(query)&&/\bpipe\b/i.test(query)&&!/\b(?:medium|class|schedule|sch|conduit|heavy|light)\b/i.test(query))query+=" Medium";
  if(/\bppr[\s-]*c\b/i.test(query)&&/\bpipe\b/i.test(query)&&!/\bpn\s*[-:]?\s*\d+/i.test(query))query+=" PN-16";
  if(/\bp[\s-]*trap\b/i.test(query)&&!/\b(?:single|double)\b/i.test(query))query+=" Single";
  if(/\bgate\s+valve\b/i.test(query)&&!/\b(?:plastic|metal|fancy|brass)\b/i.test(query))query+=" Plastic";
  return query;
}

/** Explicit dimensions/pressure/class are restrictions, never fuzzy preferences. */
export function matchesProductSpecification(query:string,candidate:string):boolean {
  if(/\bu[\s-]*pvc\b/i.test(query)&&/\bppr/i.test(candidate))return false;
  if(/\bppr/i.test(query)&&!/\bppr/i.test(candidate))return false;
  const actual=new Set(specifications(candidate,true));
  return specifications(query).every(spec=>actual.has(spec));
}
