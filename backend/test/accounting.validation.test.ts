import { describe, expect, it } from 'vitest';
import { AccountingValidationError, validateJournalLines, validatePostJournalEntry } from '../src/accounting/accounting.validation.js';

describe('accounting double-entry validation', () => {
  it('accepts a balanced journal', () => {
    expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'sales', debit: 0, credit: 100 }])).not.toThrow();
  });
  it('rejects an unbalanced journal', () => {
    expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'sales', debit: 0, credit: 90 }])).toThrow(AccountingValidationError);
  });
  it('rejects a line with both debit and credit', () => {
    expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 10 }, { accountId: 'sales', debit: 0, credit: 90 }])).toThrow('either a debit or a credit');
  });
  it('rejects a zero-value line', () => {
    expect(() => validateJournalLines([{ accountId: 'cash', debit: 0, credit: 0 }, { accountId: 'sales', debit: 0, credit: 100 }])).toThrow('either a debit or a credit');
  });
  it('requires at least two lines', () => {
    expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 0 }])).toThrow('at least two');
  });
  it('validates the complete posting contract', () => {
    expect(() => validatePostJournalEntry({ entryDate: '2026-08-15', description: 'Test sale', sourceType: 'SALE', sourceId: null, idempotencyKey: 'test-1', lines: [{ accountId: 'ar', debit: 125, credit: 0 }, { accountId: 'sales', debit: 0, credit: 125 }] })).not.toThrow();
  });
});
