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

export interface AiInputValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AiInputPipeline {
  createDraft(request: import("./ai-input.types.js").AiInputRequest): Promise<import("./ai-input.types.js").AiInputDraft>;
  validateDraft(draft: import("./ai-input.types.js").AiInputDraft): AiInputValidationResult;
  confirmDraft(
    draft: import("./ai-input.types.js").AiInputDraft,
    organizationId: string,
    userId: string,
  ): import("./ai-input.types.js").AiInputDraft;
}
