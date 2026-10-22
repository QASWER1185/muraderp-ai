import { ApiError } from "../../errors/api-error.js";
import { parseMediaDataUrl } from "../media.js";

/** Trim copy/paste padding, but reject embedded whitespace or header controls. */
export function normalizeGeminiApiKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 20 || key.length > 512 || /[^\x21-\x7e]/.test(key)) {
    throw new ApiError(400, "AI_API_KEY_INVALID", "Enter a valid Gemini API key in Copilot settings.");
  }
  return key;
}

/** Never return upstream bodies, keys, source documents or URLs to the caller. */
export async function providerJson(fetcher: typeof fetch, url: string, key: string | undefined,
  headers: Record<string,string>, body: unknown, signal?: AbortSignal): Promise<any> {
  const apiKey = key?.trim();
  if (!apiKey) throw new ApiError(503,"AI_NOT_CONFIGURED","AI provider is not configured. Manual entry remains available.");
  const outboundHeaders: Record<string, string> = {"Content-Type":"application/json", ...headers};
  if (new URL(url).origin === "https://generativelanguage.googleapis.com") {
    // X-Api-Key belongs to the browser -> ERP hop, never Google's native API.
    for (const name of Object.keys(outboundHeaders)) {
      if (["x-api-key", "x-goog-api-key", "authorization"].includes(name.toLowerCase())) delete outboundHeaders[name];
    }
    if (/[^\x21-\x7e]/.test(apiKey)) throw new ApiError(400, "AI_API_KEY_INVALID", "Enter a valid Gemini API key in Copilot settings.");
    outboundHeaders["x-goog-api-key"] = apiKey;
  }
  let response: Response;
  try { response=await fetcher(url,{method:"POST",redirect:"error",headers:outboundHeaders,body:JSON.stringify(body),signal:signal??AbortSignal.timeout(60_000)}); }
  catch { throw new ApiError(502,"AI_PROVIDER_UNAVAILABLE","AI provider could not be reached. Please retry."); }
  if(response.status===429) throw new ApiError(429,"AI_PROVIDER_RATE_LIMITED","The configured AI provider rate limit was reached. Please wait before retrying.");
  if(response.status===401 || response.status===403) throw new ApiError(401,"AI_API_KEY_REJECTED","The AI provider rejected its API key or model access. Check Copilot API key settings or contact your administrator.");
  if(response.status===402) throw new ApiError(402,"AI_PROVIDER_PAYMENT_REQUIRED","The AI provider requires an active billing plan or available credits.");
  if(response.status===404) throw new ApiError(503,"AI_MODEL_UNAVAILABLE","The configured AI model is unavailable. Check the provider model setting.");
  if(response.status===400) {
    // Gemini reports invalid API keys as HTTP 400 INVALID_ARGUMENT. Detect only
    // the known safe signature; never return or log the upstream body.
    const error = await response.clone().json().catch(() => null) as {error?:{message?:unknown;status?:unknown;details?:unknown}} | null;
    const message = typeof error?.error?.message === "string" ? error.error.message : "";
    const details = Array.isArray(error?.error?.details) ? error.error.details : [];
    const reason = details.some((item) => item && typeof item === "object" && "reason" in item && (item as {reason?:unknown}).reason === "API_KEY_INVALID");
    if (/^api key not valid\b/i.test(message) || reason) throw new ApiError(401,"AI_API_KEY_REJECTED","The AI provider rejected this API key. Check that it is active and authorized for the Gemini API.");
    throw new ApiError(502,"AI_PROVIDER_BAD_REQUEST","The AI provider rejected the request format or model settings. Check Copilot provider compatibility; re-entering the key may not resolve this error.");
  }
  if(!response.ok) throw new ApiError(502,"AI_PROVIDER_ERROR","AI provider could not process this request. Please retry or use manual entry.");
  return response.json().catch(()=>{throw new ApiError(502,"AI_INVALID_OUTPUT","AI provider returned an invalid response.");});
}
export const invalidOutput=()=>new ApiError(422,"AI_INVALID_OUTPUT","The AI result could not be validated. Please clarify or use manual entry.");
export function inlineMedia(value:unknown):{mimeType:string;data:string} {
  if(typeof value!=="string")throw invalidOutput();
  const media=parseMediaDataUrl(value);
  if(!media || !/^(?:image\/(?:png|jpeg|webp)|application\/pdf|audio\/(?:webm|mp4|mpeg|wav|ogg))$/.test(media.mimeType) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(media.data) || !media.data)
    throw new ApiError(422,"AI_INPUT_UNSUPPORTED","The provider requires valid inline image, PDF, or audio content.");
  return { ...media, mimeType: media.mimeType==="audio/mp4"?"audio/m4a":media.mimeType };
}
export function appendMessage(messages:any[],role:string,block:any,field="content") {
  const previous=messages.at(-1);
  if(previous?.role===role)previous[field].push(block);
  else messages.push({role,[field]:[block]});
}
