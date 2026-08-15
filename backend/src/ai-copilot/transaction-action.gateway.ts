import type { AiInputIntent } from "../ai-input/contracts.js";
import type { CopilotActionPlan } from "./copilot.types.js";

export interface CopilotTransactionGateway {
  createDraft(plan: CopilotActionPlan): Promise<{ draftId: string; intent: AiInputIntent }>;
  confirmDraft(
    draftId: string,
    organizationId: string,
    userId: string,
  ): Promise<{ transactionId: string; intent: AiInputIntent }>;
}

export function assertCopilotExecutionContext(
  plan: CopilotActionPlan,
  organizationId: string,
  userId: string,
): void {
  if (plan.organizationId !== organizationId) {
    throw new Error("copilot action organization mismatch");
  }
  if (plan.userId !== userId) {
    throw new Error("copilot action user mismatch");
  }
  if (plan.requiresConfirmation !== true) {
    throw new Error("copilot transaction confirmation is mandatory");
  }
}
