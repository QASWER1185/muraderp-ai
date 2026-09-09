import type { AiInputSource } from "./ai-input.types.js";

/** Compatibility contract used by the Phase 20 copilot bridge. */
export type AiInputIntent =
  | "estimate"
  | "invoice"
  | "customer_return"
  | "supplier_bill"
  | "inventory_adjustment";

export interface AiDraftField<T = unknown> {
  value: T;
  confidence: number;
  source: AiInputSource;
  rawText?: string;
}

export interface AiDraftLine {
  productName?: AiDraftField<string>;
  productId?: AiDraftField<string | number>;
  quantity?: AiDraftField<number>;
  unit?: AiDraftField<string>;
  unitRate?: AiDraftField<number>;
  /** Optional explicit list per line; required for mixed-brand pricing. */
  rateListId?: AiDraftField<string | number>;
  sourceItemId?: AiDraftField<number>;
}

export interface AiDraft {
  organizationId: string;
  intent: AiInputIntent;
  source: AiInputSource;
  customerId?: AiDraftField<string | number>;
  vendorId?: AiDraftField<string | number>;
  documentNumber?: AiDraftField<string>;
  lines: AiDraftLine[];
  totalAmount?: AiDraftField<number>;
  confidence: number;
  requiresHumanConfirmation: true;
}

export interface AiInputValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface AiInputPipelineContract {
  createDraft(request: import("./ai-input.types.js").AiInputRequest): Promise<import("./ai-input.types.js").AiInputDraft>;
  validateDraft(draftId: string, organizationId: string): Promise<import("./ai-input.types.js").AiInputDraft>;
  confirmDraft(draftId: string, organizationId: string, userId: string): Promise<void>;
}

export type {
  AiInputGateway,
  AiInputProvider,
  AiInputRequest,
  AiInputServiceContract,
  AiInputSource,
  AiInputStatus,
  AiInputDraft,
  ExtractedField,
} from "./ai-input.types.js";
