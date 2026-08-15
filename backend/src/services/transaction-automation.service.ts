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
    const existing = await this.store.find(principalScope, request.idempotencyKey);

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
      idempotencyKey: request.idempotencyKey,
      requestFingerprint: fingerprint,
      draftStatus: request.draft.status,
      requiresConfirmation: true,
    };

    await this.store.save(principalScope, command);
    return { command, created: true };
  }

  private validateRequest(request: TransactionAutomationRequest): void {
    if (!request.organizationId || !request.userId) {
      throw new ApiError(400, "TRANSACTION_CONTEXT_REQUIRED", "Organization and user context are required");
    }
    if (!request.idempotencyKey.trim()) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key is required");
    }

    const expectedType = expectedDocumentType(request.transactionType);
    if (request.draft.documentType !== expectedType) {
      throw new ApiError(
        400,
        "DOCUMENT_TYPE_MISMATCH",
        `Transaction ${request.transactionType} requires document type ${expectedType}`,
      );
    }

    validateDocumentDraft(request.draft);

    if (request.draft.organizationId !== request.organizationId) {
      throw new ApiError(403, "ORGANIZATION_BOUNDARY_VIOLATION", "Draft belongs to a different organization");
    }

    if (request.draft.createdByUserId !== request.userId) {
      throw new ApiError(403, "USER_CONTEXT_MISMATCH", "Draft user context does not match the transaction requester");
    }
  }
}

export function isTransactionReady(draft: DocumentDraft): boolean {
  return isConfirmedDraft(draft);
}
