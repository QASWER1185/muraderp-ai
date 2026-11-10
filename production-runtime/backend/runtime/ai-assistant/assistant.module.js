import { AssistantService } from "./assistant.service.js";
import { DeterministicIntentResolver } from "./deterministic-intent.resolver.js";
export function createAssistantService(authorization, gateway) {
    return new AssistantService(authorization, new DeterministicIntentResolver(), gateway);
}
//# sourceMappingURL=assistant.module.js.map