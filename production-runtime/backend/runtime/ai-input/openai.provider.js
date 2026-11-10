// Compatibility exports for existing callers. Business code uses the internal contract/factory.
import { env } from "../config/env.js";
import { createAiProvider } from "../ai/providers/factory.js";
export { ProviderDocumentExtractor, ProviderIntentResolver } from "./provider-extraction.js";
export class AiProvider {
    adapter;
    constructor(configuration, fetcher = fetch) { this.adapter = createAiProvider(configuration, fetcher); }
    get name() { return this.adapter.name; }
    generate(...args) { return this.adapter.generate(...args); }
    transcribe(...args) { return this.adapter.transcribe(...args); }
    toolTurn(...args) { return this.adapter.toolTurn(...args); }
}
/** Existing callers can retain the OpenAI-specific constructor without changing behavior. */
export class OpenAiProvider extends AiProvider {
    constructor(configuration = {
        apiKey: env.OPENAI_API_KEY, model: env.AI_MODEL ?? "gpt-6-astra", speechModel: env.AI_SPEECH_MODEL ?? "gpt-transcribe",
    }, fetcher = fetch) {
        super({ ...configuration, provider: "openai" }, fetcher);
    }
}
//# sourceMappingURL=openai.provider.js.map