import { resolveRequestGeminiKey, withGeminiBackoff } from './resilience.js';
import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { createGeminiUserProvider } from '../../ai/providers/factory.js';
import { normalizeGeminiApiKey } from '../../ai/providers/http.js';

/** V2 always uses live native Gemini, including when ERP data is a local demo. */
export function createLiveGeminiProvider(requestKey?:string) {
  const value=resolveRequestGeminiKey(requestKey)||env.GEMINI_API_KEY;
  if(!value) {
    console.warn('[COPILOT-V2] WARNING: No Gemini API Key found in env or request!');
    // Preserve the existing clear missing-key error; never choose an intent mock.
    return createGeminiUserProvider(undefined,fetch,{nativeToolsOnly:true});
  }
  const key=normalizeGeminiApiKey(value);
  const client=new GoogleGenAI({apiKey:key,httpOptions:{apiVersion:'v1beta'}});
  let dispatched=false;
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    const model=decodeURIComponent(url.pathname.split('/models/')[1]!.replace(/:generateContent$/,''));
    if(!dispatched){console.info(`[COPILOT-V2] Dispatching to Gemini Live (Model: ${model}; Key: ${requestKey?.trim()?'request':'env'})`);dispatched=true;}
    const body=JSON.parse(String(init?.body??'{}'));
    try {
      const generate=(selectedModel:string)=>client.models.generateContent({model:selectedModel,contents:body.contents,
        config:{...body.generationConfig,systemInstruction:body.systemInstruction,
          ...(body.tools?{tools:body.tools}:{}),...(body.toolConfig?{toolConfig:body.toolConfig}:{}),
          ...(init?.signal?{abortSignal:init.signal}:{})}});
      const response=await withGeminiBackoff(()=>generate(model),init?.signal??undefined);
      return new Response(JSON.stringify(response),{status:200,headers:{'content-type':'application/json'}});
    } catch(error) {
      const failure=error as {status?:number;message?:string;cause?:{code?:string;message?:string}};
      const status=failure?.status;
      const detail=String(failure?.message??error).split(key).join('[REDACTED]').replace(/AIza[\w-]+/g,'[REDACTED]').replace(/([?&]key=)[^&\s]+/g,'$1[REDACTED]');
      console.error('[COPILOT-V2] Gemini SDK error',JSON.stringify({status:status??null,message:detail.slice(0,1800),causeCode:failure?.cause?.code??null}));
      return new Response(JSON.stringify({error:{message:'Gemini SDK request failed',dailyQuota:/per day|perday|requestsperday|daily.*quota/i.test(detail)}}),
        {status:typeof status==='number'&&status>=400&&status<=599?status:502,headers:{'content-type':'application/json'}});
    }
  };
  return createGeminiUserProvider(key,transport,{nativeToolsOnly:true});
}
