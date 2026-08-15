export type AiInputSource = 'text' | 'image' | 'camera' | 'voice';

export type AiInputIntent =
  | 'estimate'
  | 'invoice'
  | 'customer_return'
  | 'supplier_bill'
  | 'inventory_adjustment';

export interface AiInputRequest {
  organizationId: string;
  source: AiInputSource;
  intent: AiInputIntent;
  text?: string;
  mediaReference?: string;
  locale?: string;
}

export interface ExtractedField<T = unknown> {
  value: T;
  confidence: number;
  source: AiInputSource;
  rawText?: string;
}

export interface AiDraftLine {
  productName?: ExtractedField<string>;
  productId?: ExtractedField<string>;
  quantity?: ExtractedField<number>;
  unit?: ExtractedField<string>;
  unitRate?: ExtractedField<number>;
}

export interface AiDraft {
  organizationId: string;
  intent: AiInputIntent;
  source: AiInputSource;
  customerId?: ExtractedField<string>;
  vendorId?: ExtractedField<string>;
  documentNumber?: ExtractedField<string>;
  lines: AiDraftLine[];
  totalAmount?: ExtractedField<number>;
  confidence: number;
  requiresHumanConfirmation: true;
}

export interface AiInputProvider {
  extract(request: AiInputRequest): Promise<AiDraft>;
}

export interface AiDraftValidator {
  validate(draft: AiDraft): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
}
