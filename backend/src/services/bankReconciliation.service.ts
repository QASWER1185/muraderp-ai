export type BankTransactionType = 'credit' | 'debit';

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
  targetType: 'customer_receipt' | 'vendor_payment' | 'ledger_entry';
  targetId: string;
  confidence: number;
  rationale: string;
  requiresConfirmation: true;
}

export class BankReconciliationService {
  normalize(transaction: BankTransaction): BankTransaction {
    if (!transaction.organizationId || !transaction.bankAccountId) throw new Error('Organization and bank account context are required');
    if (!transaction.externalId) throw new Error('Bank transaction externalId is required');
    if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) throw new Error('Bank transaction amount must be positive');
    if (!transaction.currency) throw new Error('Bank transaction currency is required');
    return { ...transaction, description: transaction.description.trim() };
  }

  deduplicate(transactions: BankTransaction[]): BankTransaction[] {
    const seen = new Set<string>();
    return transactions.filter((transaction) => {
      const key = `${transaction.organizationId}:${transaction.bankAccountId}:${transaction.externalId}:${transaction.sourceHash ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  validateSuggestion(suggestion: ReconciliationMatchSuggestion): void {
    if (!suggestion.transactionExternalId || !suggestion.targetId) throw new Error('Reconciliation match identifiers are required');
    if (suggestion.confidence < 0 || suggestion.confidence > 1) throw new Error('Match confidence must be between 0 and 1');
    if (!suggestion.rationale.trim()) throw new Error('Match rationale is required');
    if (suggestion.requiresConfirmation !== true) throw new Error('Reconciliation matches require explicit confirmation');
  }
}
