import { ApiError } from "../../errors/api-error.js";

/** Never return upstream bodies, keys, source documents or URLs to the caller. */
export async function providerJson(fetcher: typeof fetch, url: string, key: string | undefined,
  headers: Record<string,string>, body: unknown, signal?: AbortSignal): Promise<any> {
  if (!key) throw new ApiError(503,"AI_NOT_CONFIGURED","AI provider is not configured. Manual entry remains available.");
  let response: Response;
  try { response=await fetcher(url,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body),signal:signal??AbortSignal.timeout(60_000)}); }
  catch { throw new ApiError(502,"AI_PROVIDER_UNAVAILABLE","AI provider could not be reached. Please retry."); }
  if(response.status===429) throw new ApiError(429,"AI_PROVIDER_RATE_LIMITED","The configured AI provider rate limit was reached. Please wait before retrying.");
  if(!response.ok) throw new ApiError(502,"AI_PROVIDER_ERROR","AI provider could not process this request. Please retry or use manual entry.");
  return response.json().catch(()=>{throw new ApiError(502,"AI_INVALID_OUTPUT","AI provider returned an invalid response.");});
}
export const invalidOutput=()=>new ApiError(422,"AI_INVALID_OUTPUT","The AI result could not be validated. Please clarify or use manual entry.");
export function inlineMedia(value:unknown):{mimeType:string;data:string} {
  if(typeof value!=="string")throw invalidOutput();
  const match=/^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if(!match)throw new ApiError(422,"AI_INPUT_UNSUPPORTED","The provider requires inline image or PDF content.");
  return {mimeType:match[1]!,data:match[2]!};
}
export function appendMessage(messages:any[],role:string,block:any,field="content") {
  const previous=messages.at(-1);
  if(previous?.role===role)previous[field].push(block);
  else messages.push({role,[field]:[block]});
}
