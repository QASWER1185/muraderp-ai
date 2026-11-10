export class BankReconciliationService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    normalize(transaction) {
        if (!transaction.organizationId || !transaction.bankAccountId) {
            throw new Error("Organization and bank account context are required");
        }
        if (!transaction.externalId)
            throw new Error("Bank transaction externalId is required");
        if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
            throw new Error("Bank transaction amount must be positive");
        }
        if (!transaction.currency)
            throw new Error("Bank transaction currency is required");
        if (!/^\d{4}-\d{2}-\d{2}T/.test(transaction.bookedAt)) {
            throw new Error("Bank transaction bookedAt must be an ISO timestamp");
        }
        return { ...transaction, description: transaction.description.trim() };
    }
    deduplicate(transactions) {
        const seen = new Set();
        return transactions.filter((transaction) => {
            const key = `${transaction.organizationId}:${transaction.bankAccountId}:${transaction.externalId}`;
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
    }
    validateSuggestion(suggestion) {
        if (!suggestion.transactionExternalId || !suggestion.targetId) {
            throw new Error("Reconciliation match identifiers are required");
        }
        if (!Number.isFinite(suggestion.confidence) || suggestion.confidence < 0 || suggestion.confidence > 1) {
            throw new Error("Match confidence must be a finite number between 0 and 1");
        }
        if (!suggestion.rationale.trim())
            throw new Error("Match rationale is required");
        if (suggestion.requiresConfirmation !== true) {
            throw new Error("Reconciliation matches require explicit confirmation");
        }
    }
    async ingest(transactions) {
        if (!this.repository)
            throw new Error("Bank reconciliation repository is required");
        const normalized = transactions.map((transaction) => this.normalize(transaction));
        const unique = this.deduplicate(normalized);
        await this.repository.insertTransactions(unique);
        return unique;
    }
    async openSession(organizationId, bankAccountId, period) {
        if (!this.repository)
            throw new Error("Bank reconciliation repository is required");
        if (!organizationId || !bankAccountId)
            throw new Error("Organization and bank account context are required");
        if (!period.from || !period.to || period.to < period.from) {
            throw new Error("Reconciliation period is invalid");
        }
        return this.repository.createSession({ organizationId, bankAccountId, periodFrom: period.from, periodTo: period.to });
    }
    async confirmMatch(sessionId, transaction, suggestion, confirmedBy) {
        if (!this.repository)
            throw new Error("Bank reconciliation repository is required");
        if (!Number.isInteger(sessionId) || sessionId <= 0)
            throw new Error("Reconciliation session id is required");
        if (!confirmedBy.trim())
            throw new Error("Confirmation user is required");
        this.validateSuggestion(suggestion);
        const persisted = await this.repository.findTransactionByExternalId(transaction.organizationId, transaction.bankAccountId, transaction.externalId);
        if (!persisted?.id)
            throw new Error("Bank transaction was not found");
        await this.repository.recordMatch(sessionId, {
            transactionId: persisted.id,
            targetType: suggestion.targetType,
            targetId: suggestion.targetId,
            confidence: suggestion.confidence,
            rationale: suggestion.rationale.trim(),
            confirmedBy: confirmedBy.trim(),
        });
    }
    async completeSession(sessionId) {
        if (!this.repository)
            throw new Error("Bank reconciliation repository is required");
        if (!Number.isInteger(sessionId) || sessionId <= 0)
            throw new Error("Reconciliation session id is required");
        await this.repository.completeSession(sessionId);
    }
}
//# sourceMappingURL=bankReconciliation.service.js.map