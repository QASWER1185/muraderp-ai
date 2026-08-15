import type { JournalLineInput, PostJournalEntryInput } from './accounting.types.js';

export class AccountingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountingValidationError';
  }
}

export function validateJournalLines(lines: JournalLineInput[]): void {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new AccountingValidationError('Journal entry requires at least two lines.');
  }

  let debitTotal = 0;
  let creditTotal = 0;

  for (const line of lines) {
    if (!line.accountId) {
      throw new AccountingValidationError('Journal line requires an account.');
    }
    if (!Number.isFinite(line.debit) || !Number.isFinite(line.credit)) {
      throw new AccountingValidationError('Journal amounts must be finite numbers.');
    }
    if (line.debit < 0 || line.credit < 0) {
      throw new AccountingValidationError('Journal amounts cannot be negative.');
    }
    if ((line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
      throw new AccountingValidationError('Each journal line must contain either a debit or a credit.');
    }
    debitTotal += line.debit;
    creditTotal += line.credit;
  }

  if (debitTotal <= 0 || Math.abs(debitTotal - creditTotal) > 0.0001) {
    throw new AccountingValidationError('Journal entry must be balanced and non-zero.');
  }
}

export function validatePostJournalEntry(input: PostJournalEntryInput): void {
  if (!input.entryDate || !input.description || !input.sourceType) {
    throw new AccountingValidationError('Journal entry date, description, and source type are required.');
  }
  validateJournalLines(input.lines);
}
