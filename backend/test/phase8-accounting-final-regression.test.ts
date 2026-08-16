import { describe, expect, it } from 'vitest';
import { AccountingValidationError, validateJournalLines, validatePostJournalEntry } from '../src/accounting/accounting.validation.js';

describe('Phase 8 final accounting regression contract', () => {
  it('accepts a multi-line balanced double-entry journal', () => {
    expect(() => validateJournalLines([
      { accountId: 'inventory', debit: 1000, credit: 0 },
      { accountId: 'cash', debit: 0, credit: 700 },
      { accountId: 'payable', debit: 0, credit: 300 },
    ])).not.toThrow();
  });

  it('rejects negative debit or credit values', () => {
    expect(() => validateJournalLines([
      { accountId: 'cash', debit: -1, credit: 0 },
      { accountId: 'sales', debit: 0, credit: -1 },
    ])).toThrow(AccountingValidationError);
  });

  it('rejects non-finite monetary values', () => {
    expect(() => validateJournalLines([
      { accountId: 'cash', debit: Number.NaN, credit: 0 },
      { accountId: 'sales', debit: 0, credit: 100 },
    ])).toThrow('finite numbers');
  });

  it('rejects journals that contain only zero totals', () => {
    expect(() => validateJournalLines([
      { accountId: 'cash', debit: 0, credit: 0 },
      { accountId: 'sales', debit: 0, credit: 0 },
    ])).toThrow('either a debit or a credit');
  });

  it('requires the authoritative posting metadata', () => {
    expect(() => validatePostJournalEntry({
      entryDate: '2026-08-16',
      description: '',
      sourceType: 'SALE',
      sourceId: null,
      idempotencyKey: 'phase8-final-1',
      lines: [
        { accountId: 'ar', debit: 250, credit: 0 },
        { accountId: 'sales', debit: 0, credit: 250 },
      ],
    })).toThrow('date, description, and source type are required');
  });

  it('keeps posting input balanced at the validation boundary', () => {
    expect(() => validatePostJournalEntry({
      entryDate: '2026-08-16',
      description: 'Phase 8 regression sale',
      sourceType: 'SALE',
      sourceId: null,
      idempotencyKey: 'phase8-final-2',
      lines: [
        { accountId: 'ar', debit: 1250, credit: 0 },
        { accountId: 'sales', debit: 0, credit: 1250 },
      ],
    })).not.toThrow();
  });
});
