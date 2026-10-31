import { setTimeout as delay } from 'node:timers/promises';

export function resolveRequestGeminiKey(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new TypeError('Invalid Gemini key header');
  const key=value.trim();
  return !key || /^(null|undefined)$/i.test(key) ? undefined : key;
}
export async function withGeminiBackoff<T>(operation:()=>Promise<T>, signal?:AbortSignal,
  wait:(ms:number)=>Promise<unknown> = ms=>delay(ms,undefined,signal?{signal}:undefined)):Promise<T> {
  for(let retry=0;;retry++) {
    signal?.throwIfAborted();
    try { return await operation(); }
    catch(error) {
      const e=error as {status?:number|string;error?:{status?:string}};
      if(signal?.aborted || retry>=3 || !(e.status===429 || e.status===503 || e.status==='UNAVAILABLE' || e.status==='RESOURCE_EXHAUSTED' || e.error?.status==='RESOURCE_EXHAUSTED')) throw error;
      await wait(2000*2**retry);
    }
  }
}
export function stripHistoricalMedia(messages:Array<{role:'user'|'assistant';content:string;visualParts?:unknown[]}>) {
  return messages.map(({role,content,visualParts})=>({role,content:content.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=\r\n]+/g,'[Attached Slip Image]')+(visualParts?.length?'\n[Attached Slip Image/PDF]':'')}));
}
