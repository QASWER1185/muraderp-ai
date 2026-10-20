/** Exact whole-turn affirmations only; quoted/embedded approval is never enough. */
export function isAffirmation(message:string):boolean {
  const text=message.normalize("NFKC").trim().toLowerCase().replace(/[.!،۔!?؟]+$/gu,"").trim();
  return /^(?:جی|ہاں|جی ہاں|کر دیں|جی کر دیں|درج کر دیں|جی درج کر دیں|محفوظ کر دیں|yes|ok|okay|confirm|save|ji|jee|han|haan|kar dein|ker dein|darj kar dein|darj ker dein)$/u.test(text);
}
export function executionIdentity(result:any):unknown {
  return result?.invoice_id??result?.invoice?.id??result?.payment?.id??result?.rate_list?.id??result?.id??result?.version?.id;
}
