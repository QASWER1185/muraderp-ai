import type { DocumentDraft, DocumentDraftStatus, DocumentType } from "./document-intelligence.types.js";

export type AutomatedTransactionType =
  | "ESTIMATE"
  | "CUSTOMER_INVOICE"
  | "SUPPLIER_BILL"
  | "CUSTOMER_RETURN"
  | "PURCHASE_RETURN"
  | "INVENTORY_COUNT";

export type TransactionCommandStatus = "READY" | "REQUIRES_REVIEW" | "REJECTED";

export interface TransactionAutomationRequest {
  organizationId: string;
  userId: string;
  transactionType: AutomatedTransactionType;
  draft: DocumentDraft;
  idempotencyKey: string;
}

export interface TransactionCommand {
  organizationId: string;
  userId: string;
  transactionType: AutomatedTransactionType;
  sourceDocumentType: DocumentType;
  status: TransactionCommandStatus;
  idempotencyKey: string;
  requestFingerprint: string;
  draftStatus: DocumentDraftStatus;
  requiresConfirmation: true;
}

export interface TransactionAutomationResult {
  command: TransactionCommand;
  created: boolean;
}

const documentTypeByTransaction: Record<AutomatedTransactionType, DocumentType> = {
  ESTIMATE: "estimate",
  CUSTOMER_INVOICE: "customer_invoice",
  SUPPLIER_BILL: "supplier_bill",
  CUSTOMER_RETURN: "customer_return",
  PURCHASE_RETURN: "purchase_return",
  INVENTORY_COUNT: "inventory_count",
};

export function expectedDocumentType(transactionType: AutomatedTransactionType): DocumentType {
  return documentTypeByTransaction[transactionType];
}

export function isConfirmedDraft(draft: DocumentDraft): boolean {
  return draft.status === "confirmed" && draft.requiresConfirmation === true;
}
