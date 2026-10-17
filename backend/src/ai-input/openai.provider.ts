// Compatibility exports for existing callers. Business code uses the internal contract/factory.
import {env} from "../config/env.js";
import {createAiProvider} from "../ai/providers/factory.js";
import type {AiProviderConfiguration,AiProviderContract} from "../ai/providers/contracts.js";
export type {StructuredAiProvider} from "../ai/providers/contracts.js";
export {ProviderDocumentExtractor,ProviderIntentResolver} from "./provider-extraction.js";
export class AiProvider implements AiProviderContract {
 private readonly adapter:AiProviderContract;
 constructor(configuration?:AiProviderConfiguration,fetcher:typeof fetch=fetch){this.adapter=createAiProvider(configuration,fetcher);}
 get name(){return this.adapter.name;}
 generate(...args:Parameters<AiProviderContract["generate"]>){return this.adapter.generate(...args);}
 transcribe(...args:Parameters<AiProviderContract["transcribe"]>){return this.adapter.transcribe(...args);}
 toolTurn(...args:Parameters<AiProviderContract["toolTurn"]>){return this.adapter.toolTurn(...args);}
}

/** Existing callers can retain the OpenAI-specific constructor without changing behavior. */
export class OpenAiProvider extends AiProvider {
  constructor(configuration: Omit<AiProviderConfiguration, "provider"> = {
    apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL ?? "gpt-6-astra", speechModel: env.AI_SPEECH_MODEL ?? "gpt-transcribe",
  }, fetcher: typeof fetch = fetch) {
    super({ ...configuration, provider: "openai" }, fetcher);
  }
}
