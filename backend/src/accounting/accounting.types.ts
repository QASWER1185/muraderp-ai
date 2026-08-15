export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type NormalBalance = 'DEBIT' | 'CREDIT';

export interface Account {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  isActive: boolean;
  parentAccountId?: string | null;
}

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

export interface PostJournalEntryInput {
  entryDate: string;
  description: string;
  sourceType: string;
  sourceId?: string | null;
  idempotencyKey?: string | null;
  lines: JournalLineInput[];
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
}
