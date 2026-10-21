export type AiInputSource = "text" | "image" | "camera" | "voice";

export type AiInputIntent =
  | "estimate.create"
  | "invoice.create"
  | "customer_return.create"
  | "supplier_bill.create"
  | "inventory.adjust"
  | "rate_list.import";

export type AiInputStatus = "draft" | "validated" | "confirmed" | "rejected";

export interface AiInputRequest {
  source: AiInputSource;
  intent: AiInputIntent;
  organizationId: string;
  userId: string;
  text?: string;
  mediaReference?: string;
  locale?: string;
  /** Request-only bytes. Never saved in a draft or sent to a caller as a URL. */
  media?: { mimeType: string; base64: string };
}

export interface ExtractedField<T = unknown> {
  value: T;
  confidence: number;
  source: AiInputSource;
}

export interface AiInputDraft {
  draftId: string;
  source: AiInputSource;
  intent: AiInputIntent;
  organizationId: string;
  userId: string;
  status: AiInputStatus;
  fields: Record<string, ExtractedField>;
  requiresConfirmation: true;
}

export interface AiInputProvider {
  extract(request: AiInputRequest): Promise<AiInputDraft>;
}

export interface AiInputGateway {
  saveDraft(draft: AiInputDraft): Promise<AiInputDraft>;
  getDraft(draftId: string): Promise<AiInputDraft | undefined>;
}

export interface AiInputServiceContract {
  createDraft(request: AiInputRequest): Promise<AiInputDraft>;
  validateDraft(draftId: string, organizationId: string): Promise<AiInputDraft>;
  confirmDraft(draftId: string, organizationId: string, userId: string): Promise<void>;
}
