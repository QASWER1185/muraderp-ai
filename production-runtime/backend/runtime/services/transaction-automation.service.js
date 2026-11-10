import { createHash } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { validateDocumentDraft } from "../types/document-intelligence.types.js";
import { expectedDocumentType, isConfirmedDraft, } from "../types/transaction-automation.types.js";
const AUTOMATED_TRANSACTION_TYPES = new Set([
    "ESTIMATE",
    "CUSTOMER_INVOICE",
    "SUPPLIER_BILL",
    "CUSTOMER_RETURN",
    "PURCHASE_RETURN",
    "INVENTORY_COUNT",
]);
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stableValue(item)]));
    }
    return value;
}
export function fingerprintTransactionRequest(request) {
    const canonical = JSON.stringify(stableValue({
        organizationId: request.organizationId,
        userId: request.userId,
        transactionType: request.transactionType,
        draft: request.draft,
    }));
    return createHash("sha256").update(canonical).digest("hex");
}
export class InMemoryTransactionCommandStore {
    commands = new Map();
    async find(principalScope, idempotencyKey) {
        return this.commands.get(`${principalScope}:${idempotencyKey}`) ?? null;
    }
    async save(principalScope, command) {
        this.commands.set(`${principalScope}:${command.idempotencyKey}`, command);
    }
}
export class TransactionAutomationService {
    store;
    constructor(store) {
        this.store = store;
    }
    async prepare(request) {
        this.validateRequest(request);
        const principalScope = request.organizationId;
        const fingerprint = fingerprintTransactionRequest(request);
        const existing = await this.store.find(principalScope, request.idempotencyKey.trim());
        if (existing) {
            if (existing.requestFingerprint !== fingerprint) {
                throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for a different transaction request");
            }
            return { command: existing, created: false };
        }
        const command = {
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
    validateRequest(request) {
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
            throw new ApiError(400, "IDEMPOTENCY_KEY_TOO_LONG", `An Idempotency-Key must be ${MAX_IDEMPOTENCY_KEY_LENGTH} characters or fewer`);
        }
        if (typeof request.transactionType !== "string" ||
            !AUTOMATED_TRANSACTION_TYPES.has(request.transactionType)) {
            throw new ApiError(400, "UNSUPPORTED_TRANSACTION_TYPE", "Unsupported automated transaction type");
        }
        const draft = request.draft;
        if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
            throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "A valid document draft is required");
        }
        if (!Array.isArray(draft.matches)) {
            throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "Document entity matches must be an array");
        }
        if (!draft.extractedFields || typeof draft.extractedFields !== "object" || Array.isArray(draft.extractedFields)) {
            throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", "Document extracted fields must be an object");
        }
        const expectedType = expectedDocumentType(request.transactionType);
        if (draft.documentType !== expectedType) {
            throw new ApiError(400, "DOCUMENT_TYPE_MISMATCH", `Transaction ${request.transactionType} requires document type ${expectedType}`);
        }
        try {
            validateDocumentDraft(draft);
        }
        catch (error) {
            throw new ApiError(400, "DOCUMENT_DRAFT_INVALID", error instanceof Error ? error.message : "Document draft validation failed");
        }
        if (draft.organizationId !== request.organizationId) {
            throw new ApiError(403, "ORGANIZATION_BOUNDARY_VIOLATION", "Draft belongs to a different organization");
        }
        if (draft.createdByUserId !== request.userId) {
            throw new ApiError(403, "USER_CONTEXT_MISMATCH", "Draft user context does not match the transaction requester");
        }
    }
}
export function isTransactionReady(draft) {
    return isConfirmedDraft(draft);
}
//# sourceMappingURL=transaction-automation.service.js.map