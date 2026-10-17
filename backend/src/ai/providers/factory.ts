import { env } from "../../config/env.js";
import { ApiError } from "../../errors/api-error.js";
import type { AiProviderName,AiProviderContract,AiProviderConfiguration } from "./contracts.js";
import { ResponsesAdapter } from "./responses.adapter.js";
import { GeminiAdapter } from "./gemini.adapter.js";
import { AnthropicAdapter } from "./anthropic.adapter.js";

function providerKey(name:AiProviderName){return name==="openai"?env.OPENAI_API_KEY:name==="groq"?env.GROQ_API_KEY:name==="gemini"?env.GEMINI_API_KEY:name==="anthropic"?env.ANTHROPIC_API_KEY:undefined;}
function speechModel(name:AiProviderName,model:string){return name==="groq"?"whisper-large-v3-turbo":name==="gemini"||name==="anthropic"?model:"gpt-transcribe";}
export function configuredAiProvider():AiProviderConfiguration {
  const provider=env.AI_PROVIDER??(env.GROQ_API_KEY?"groq":env.OPENAI_API_KEY?"openai":env.GEMINI_API_KEY?"gemini":env.ANTHROPIC_API_KEY?"anthropic":"groq");
  const model=env.AI_MODEL??(provider==="groq"?"openai/gpt-oss-120b":provider==="openai"?"gpt-6-astra":"");
  return {provider,apiKey:env.AI_API_KEY??providerKey(provider),baseUrl:env.AI_BASE_URL,model,
    visionModel:env.AI_VISION_MODEL??(provider==="groq"?"qwen/qwen3.8-27b":undefined),
    speechModel:env.AI_SPEECH_MODEL??speechModel(env.AI_SPEECH_PROVIDER??provider,model),
    speechProvider:env.AI_SPEECH_PROVIDER,speechApiKey:env.AI_SPEECH_API_KEY??(env.AI_SPEECH_PROVIDER===provider?env.AI_API_KEY:undefined)??(env.AI_SPEECH_PROVIDER?providerKey(env.AI_SPEECH_PROVIDER):undefined),speechBaseUrl:env.AI_SPEECH_BASE_URL};
}
function adapter(config:AiProviderConfiguration,fetcher:typeof fetch):AiProviderContract {
  if(!config.model.trim())throw new ApiError(503,"AI_NOT_CONFIGURED","Configure AI_MODEL for the selected provider.");
  if(config.provider==="gemini")return new GeminiAdapter(config,fetcher);
  if(config.provider==="anthropic")return new AnthropicAdapter(config,fetcher);
  if(config.provider==="compatible"){
    let valid=false;try{const url=new URL(config.baseUrl??"");valid=url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{}
    if(!valid)throw new ApiError(503,"AI_NOT_CONFIGURED","Compatible providers require a secure server-configured HTTPS endpoint.");
  }
  return new ResponsesAdapter(config,fetcher);
}
/** Select once by server configuration. No automatic provider fallback or billing changes. */
export function createAiProvider(config:AiProviderConfiguration=configuredAiProvider(),fetcher:typeof fetch=fetch):AiProviderContract {
  const primary=adapter(config,fetcher);if(!config.speechProvider)return primary;
  if(config.speechProvider==="anthropic")throw new ApiError(503,"AI_NOT_CONFIGURED","Choose a provider with a supported transcription adapter.");
  const speech=adapter({provider:config.speechProvider,apiKey:config.speechApiKey,baseUrl:config.speechBaseUrl,model:config.speechModel,speechModel:config.speechModel},fetcher);
  return {name:primary.name,generate:primary.generate.bind(primary),toolTurn:primary.toolTurn.bind(primary),transcribe:speech.transcribe.bind(speech)};
}
