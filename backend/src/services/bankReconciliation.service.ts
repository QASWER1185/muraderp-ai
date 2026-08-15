import type {
  BankReconciliationRepository,
  ReconciliationSession,
} from "../repositories/bank-reconciliation.repository.js";

export type BankTransactionType = "credit" | "debit";

export interface BankTransaction {
  organizationId: string;
  externalId: string;
  bankAccountId: string;
  bookedAt: string;
  amount: number;
  currency: string;
  type: BankTransactionType;
  description: string;
  sourceHash?: string;
}

export interface ReconciliationMatchSuggestion {
  transactionExternalId: string;
  targetType: "customer_receipt" | "vendor_payment" | "ledger_entry";
  targetId: string;
  confidence: number;
  rationale: string;
  requiresConfirmation: true;
}

export interface ReconciliationPeriod {
  from: string;
  to: string;
}

export class BankReconciliationService {
  constructor(private readonly repository?: BankReconciliationRepository) {}

  normalize(transaction: BankTransaction): BankTransaction {
    if (!transaction.organizationId || !transaction.bankAccountId) {
      throw new Error("Organization and bank account context are required");
    }
    if (!transaction.externalId) throw new Error("Bank transaction externalId is required");
    if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
      throw new Error("Bank transaction amount must be positive");
    }
    if (!transaction.currency) throw new Error("Bank transaction currency is required");
    if (!/^\d{4}-\d{2}-\d{2}T/.test(transaction.bookedAt)) {
      throw new Error("Bank transaction bookedAt must be an ISO timestamp");
    }
    return { ...transaction, description: transaction.description.trim() };
  }

  deduplicate(transactions: BankTransaction[]): BankTransaction[] {
    const seen = new Set<string>();
    return transactions.filter((transaction) => {
      const key = `${transaction.organizationId}:${transaction.bankAccountId}:${transaction.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  validateSuggestion(suggestion: ReconciliationMatchSuggestion): void {
    if (!suggestion.transactionExternalId || !suggestion.targetId) {
      throw new Error("Reconciliation match identifiers are required");
    }
    if (suggestion.confidence < 0 || suggestion.confidence > 1) {
      throw new Error("Match confidence must be between 0 and 1");
    }
    if (!suggestion.rationale.trim()) throw new Error("Match rationale is required");
    if (suggestion.requiresConfirmation !== true) {
      throw new Error("Reconciliation matches require explicit confirmation");
    }
  }

  async ingest(transactions: BankTransaction[]): Promise<BankTransaction[]> {
    if (!this.repository) throw new Error("Bank reconciliation repository is required");
    const normalized = transactions.map((transaction) => this.normalize(transaction));
    const unique = this.deduplicate(normalized);
    await this.repository.insertTransactions(unique);
    return unique;
  }

  async openSession(
    organizationId: string,
    bankAccountId: string,
    period: ReconciliationPeriod,
  ): Promise<ReconciliationSession> {
    if (!this.repository) throw new Error("Bank reconciliation repository is required");
    if (!organizationId || !bankAccountId) throw new Error("Organization and bank account context are required");
    if (!period.from || !period.to || period.to < period.from) {
      throw new Error("Reconciliation period is invalid");
    }
    return this.repository.createSession({ organizationId, bankAccountId, periodFrom: period.from, periodTo: period.to });
  }

  async confirmMatch(
    sessionId: number,
    transaction: BankTransaction,
    suggestion: ReconciliationMatchSuggestion,
    confirmedBy: string,
  ): Promise<void> {
    if (!this.repository) throw new Error("Bank reconciliation repository is required");
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("Reconciliation session id is required");
    if (!confirmedBy.trim()) throw new Error("Confirmation user is required");
    this.validateSuggestion(suggestion);
    const persisted = await this.repository.findTransactionByExternalId(
      transaction.organizationId,
      transaction.bankAccountId,
      transaction.externalId,
    );
    if (!persisted?.id) throw new Error("Bank transaction was not found");
    await this.repository.recordMatch(sessionId, {
      transactionId: persisted.id,
      targetType: suggestion.targetType,
      targetId: suggestion.targetId,
      confidence: suggestion.confidence,
      rationale: suggestion.rationale.trim(),
      confirmedBy: confirmedBy.trim(),
    });
  }

  async completeSession(sessionId: number): Promise<void> {
    if (!this.repository) throw new Error("Bank reconciliation repository is required");
    if (!Number.isInteger(sessionId) || sessionId <= 0) throw new Error("Reconciliation session id is required");
    await this.repository.completeSession(sessionId);
  }
}
