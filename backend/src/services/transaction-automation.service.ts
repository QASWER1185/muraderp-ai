import { createHash } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { validateDocumentDraft } from "../types/document-intelligence.types.js";
import type { DocumentDraft } from "../types/document-intelligence.types.js";
import {
  expectedDocumentType,
  isConfirmedDraft,
  type AutomatedTransactionType,
  type TransactionAutomationRequest,
  type TransactionAutomationResult,
  type TransactionCommand,
} from "../types/transaction-automation.types.js";

const AUTOMATED_TRANSACTION_TYPES: ReadonlySet<AutomatedTransactionType> = new Set([
  "ESTIMATE",
  "CUSTOMER_INVOICE",
  "SUPPLIER_BILL",
  "CUSTOMER_RETURN",
  "PURCHASE_RETURN",
  "INVENTORY_COUNT",
]);

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function fingerprintTransactionRequest(request: TransactionAutomationRequest): string {
  const canonical = JSON.stringify(
    stableValue({
      organizationId: request.organizationId,
      userId: request.userId,
      transactionType: request.transactionType,
      draft: request.draft,
    }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export interface TransactionCommandStore {
  find(principalScope: string, idempotencyKey: string): Promise<TransactionCommand | null>;
  save(principalScope: string, command: TransactionCommand): Promise<void>;
}

export class InMemoryTransactionCommandStore implements TransactionCommandStore {
  private readonly commands = new Map<string, TransactionCommand>();

  async find(principalScope: string, idempotencyKey: string): Promise<TransactionCommand | null> {
    return this.commands.get(`${principalScope}:${idempotencyKey}`) ?? null;
  }

  async save(principalScope: string, command: TransactionCommand): Promise<void> {
    this.commands.set(`${principalScope}:${command.idempotencyKey}`, command);
  }
}

export class TransactionAutomationService {
  constructor(private readonly store: TransactionCommandStore) {}

  async prepare(request: TransactionAutomationRequest): Promise<TransactionAutomationResult> {
    this.validateRequest(request);

    const principalScope = request.organizationId;
    const fingerprint = fingerprintTransactionRequest(request);
    const existing = await this.store.find(principalScope, request.idempotencyKey.trim());

    if (existing) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "The Idempotency-Key was already used for a different transaction request",
        );
      }
      return { command: existing, created: false };
    }

    const command: TransactionCommand = {
      organizationId: request.organizationId,
      userId: request.userId,
      transactionType: request.transactionType,
      sourceDocumentType: request.draft.documentType,
      status: isConfirmedDraft(request.draft) ? "READY" : "REQUIRES_REVIEW",
      idempotencyKey: request.idempotencyKey.trim(),
      requestFingerprint: fingerprint,
      draftStatus: request.draft.status,
      requiresConfirmation: true,
    };

    await this.store.save(principalScope, command);
    return { command, created: true };
  }

  private validateRequest(request: TransactionAutomationRequest): void {
    if (!request || typeof request !== "object") {
      throw new ApiError(400, "TRANSACTION_REQUEST_INVALID", "A valid transaction request is required");
    }

    if (typeof request.organizationId !== "string" || !request.organizationId.trim()) {
      throw new ApiError(400, "TRANSACTION_CONTEXT_REQUIRED", "Organization and user context are required");
    }
    if (typeof request.userId !== "string" || !request.userId.trim()) {
      throw new ApiError(400, "TRANSACTION_CONTEXT_REQUIRED", "Organization and user context are required");
    }
    if (typeof request.idempotencyKey !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key is required");
    }
    const idempotencyKey = request.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key is required");
    }
    if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ApiError(
        400,
        "IDEMPOTENCY_KEY_TOO_LONG",
        `An Idempotency-Key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer`,
      );
    }

    if (
      typeof request.transactionType !== "string" ||
      !AUTOMATED_TRANSACTION_TYPES.has(request.transactionType as AutomatedTransactionType)
    ) {
      throw new ApiError(400, "UNSUPPORTED_TRANSACTION_TYPE", "Unsupported automated transaction type");
    }

    const draft = request.draft as DocumentDraft;
    if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
      throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "A valid document draft is required");
    }
    if (!Array.isArray(draft.matches)) {
      throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "Document entity matches must be an array");
    }
    if (!draft.extractedFields || typeof draft.extractedFields !== "object" || Array.isArray(draft.extractedFields)) {
      throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "Document extracted fields must be an object");
    }

    const expectedType = expectedDocumentType(request.transactionType as AutomatedTransactionType);
    if (draft.documentType !== expectedType) {
      throw new ApiError(
        400,
        "DOCUMENT_TYPE_MISMATCH",
        `Transaction ${request.transactionType} requires document type ${expectedType}`,
      );
    }

    try {
      validateDocumentDraft(draft);
    } catch (error) {
      throw new ApiError(
        400,
        "DOCUMENT_DRAFT_INVALID",
        error instanceof Error ? error.message : "Document draft validation failed",
      );
    }

    if (draft.organizationId !== request.organizationId) {
      throw new ApiError(403, "ORGANIZATION_BOUNDARY_VIOLATION", "Draft belongs to a different organization");
    }

    if (draft.createdByUserId !== request.userId) {
      throw new ApiError(403, "USER_CONTEXT_MISMATCH", "Draft user context does not match the transaction requester");
    }
  }
}

export function isTransactionReady(draft: DocumentDraft): boolean {
  return isConfirmedDraft(draft);
}
