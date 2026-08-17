export type {
  AiInputGateway,
  AiInputIntent,
  AiInputProvider,
  AiInputRequest,
  AiInputServiceContract,
  AiInputSource,
  AiInputStatus,
  AiInputDraft,
  ExtractedField,
} from "./ai-input.types.js";

import type { AiInputDraft, AiInputRequest } from "./ai-input.types.js";

export interface AiInputValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AiInputPipelineContract {
  createDraft(request: AiInputRequest): Promise<AiInputDraft>;
  validateDraft(draftId: string, organizationId: string): Promise<AiInputDraft>;
  confirmDraft(draftId: string, organizationId: string, userId: string): Promise<void>;
}
