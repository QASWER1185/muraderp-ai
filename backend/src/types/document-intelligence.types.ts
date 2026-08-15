export type DocumentSource = 'camera' | 'upload' | 'voice' | 'text';

export type DocumentType =
  | 'supplier_bill'
  | 'supplier_invoice'
  | 'customer_invoice'
  | 'estimate'
  | 'customer_return'
  | 'purchase_return'
  | 'supplier_rate_list'
  | 'delivery_document'
  | 'inventory_count';

export type DocumentDraftStatus = 'draft' | 'needs_review' | 'validated' | 'confirmed' | 'rejected';

export interface DocumentProvenance {
  source: DocumentSource;
  mediaReference?: string;
  extractedAt: string;
  provider?: string;
  sourceHash?: string;
}

export interface DocumentEntityMatch {
  entityType: 'customer' | 'vendor' | 'product' | 'warehouse' | 'invoice' | 'estimate';
  inputValue: string;
  matchedId?: string;
  confidence: number;
}

export interface DocumentDraft {
  organizationId: string;
  createdByUserId: string;
  documentType: DocumentType;
  status: DocumentDraftStatus;
  provenance: DocumentProvenance;
  extractedFields: Record<string, unknown>;
  matches: DocumentEntityMatch[];
  confidence: number;
  requiresConfirmation: true;
}

export interface BusinessMessageIntent {
  organizationId: string;
  userId: string;
  direction: 'inbound' | 'outbound';
  channel: 'internal' | 'whatsapp' | 'email' | 'other';
  relatedEntityType?: 'customer' | 'vendor' | 'invoice' | 'estimate' | 'purchase' | 'return';
  relatedEntityId?: string;
  body: string;
  requiresAuthorization: true;
}

export function validateDocumentDraft(draft: DocumentDraft): void {
  if (!draft.organizationId || !draft.createdByUserId) throw new Error('Organization and user context are required');
  if (!draft.provenance?.source || !draft.provenance?.extractedAt) throw new Error('Document provenance is required');
  if (draft.confidence < 0 || draft.confidence > 1) throw new Error('Document confidence must be between 0 and 1');
  if (draft.requiresConfirmation !== true) throw new Error('Document drafts always require confirmation');
  for (const match of draft.matches) {
    if (match.confidence < 0 || match.confidence > 1) throw new Error('Entity match confidence must be between 0 and 1');
  }
}

export function validateBusinessMessageIntent(message: BusinessMessageIntent): void {
  if (!message.organizationId || !message.userId) throw new Error('Organization and user context are required');
  if (!message.body.trim()) throw new Error('Message body is required');
  if (message.requiresAuthorization !== true) throw new Error('Business messages require authorization');
}
