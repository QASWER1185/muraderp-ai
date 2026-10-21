import type { AssistantDecision } from "./assistant.types.js";

export function requiresExplicitConfirmation(decision: AssistantDecision): boolean {
  return decision === "draft";
}
