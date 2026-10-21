import { AssistantService } from "./assistant.service.js";
import { DeterministicIntentResolver } from "./deterministic-intent.resolver.js";
import type { AuthorizationService } from "../auth/authorization.service.js";
import type { AssistantActionGateway } from "./assistant.types.js";

export function createAssistantService(
  authorization: AuthorizationService,
  gateway: AssistantActionGateway,
): AssistantService {
  return new AssistantService(authorization, new DeterministicIntentResolver(), gateway);
}
