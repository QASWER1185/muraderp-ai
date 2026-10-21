import { describe, expect, it } from 'vitest';
import { validateJournalLines } from '../src/accounting/accounting.validation.js';

describe('accounting validation additional cases', () => {
  it('accepts a balanced journal', () => expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'sales', debit: 0, credit: 100 }])).not.toThrow());
  it('rejects an unbalanced journal', () => expect(() => validateJournalLines([{ accountId: 'cash', debit: 100, credit: 0 }, { accountId: 'sales', debit: 0, credit: 90 }])).toThrow());
  it('rejects negative amounts', () => expect(() => validateJournalLines([{ accountId: 'cash', debit: -1, credit: 0 }, { accountId: 'sales', debit: 0, credit: 1 }])).toThrow());
});
