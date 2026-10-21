import { getSupabaseAdminClient } from "../config/supabase.js";

export interface PersistedBankTransaction {
  id?: number;
  organizationId: string;
  bankAccountId: string;
  externalId: string;
  bookedAt: string;
  amount: number;
  currency: string;
  type: "credit" | "debit";
  description: string;
  sourceHash?: string | null;
}

export interface ReconciliationSession {
  id: number;
  organizationId: string;
  bankAccountId: string;
  periodFrom: string;
  periodTo: string;
  status: "open" | "completed" | "cancelled";
}

export interface ReconciliationMatchRecord {
  transactionId: number;
  targetType: "customer_receipt" | "vendor_payment" | "ledger_entry";
  targetId: string;
  confidence: number;
  rationale: string;
  confirmedBy: string;
}

export interface BankReconciliationRepository {
  insertTransactions(transactions: PersistedBankTransaction[]): Promise<PersistedBankTransaction[]>;
  findTransactionByExternalId(organizationId: string, bankAccountId: string, externalId: string): Promise<PersistedBankTransaction | null>;
  createSession(input: Omit<ReconciliationSession, "id" | "status">): Promise<ReconciliationSession>;
  recordMatch(sessionId: number, match: ReconciliationMatchRecord): Promise<void>;
  completeSession(sessionId: number): Promise<void>;
}

/**
 * Uses the existing privileged ERP client. The migration owns the database
 * contract; this repository deliberately keeps the generated Database type
 * decoupled until Supabase type generation is refreshed from the deployed
 * schema.
 */
export class SupabaseBankReconciliationRepository implements BankReconciliationRepository {
  constructor(private readonly clientFactory: () => any = getSupabaseAdminClient) {}

  async insertTransactions(transactions: PersistedBankTransaction[]): Promise<PersistedBankTransaction[]> {
    if (transactions.length === 0) return [];
    const client = this.clientFactory();
    const rows = transactions.map((transaction) => ({
      organization_id: transaction.organizationId,
      bank_account_id: transaction.bankAccountId,
      external_id: transaction.externalId,
      booked_at: transaction.bookedAt,
      amount: transaction.amount,
      currency: transaction.currency,
      transaction_type: transaction.type,
      description: transaction.description,
      source_hash: transaction.sourceHash ?? null,
    }));
    const { data, error } = await client.from("bank_transactions").upsert(rows, {
      onConflict: "organization_id,bank_account_id,external_id",
      ignoreDuplicates: true,
    }).select("id, organization_id, bank_account_id, external_id, booked_at, amount, currency, transaction_type, description, source_hash");
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      bankAccountId: row.bank_account_id,
      externalId: row.external_id,
      bookedAt: row.booked_at,
      amount: Number(row.amount),
      currency: row.currency,
      type: row.transaction_type,
      description: row.description,
      sourceHash: row.source_hash,
    }));
  }

  async findTransactionByExternalId(organizationId: string, bankAccountId: string, externalId: string): Promise<PersistedBankTransaction | null> {
    const client = this.clientFactory();
    const { data, error } = await client.from("bank_transactions")
      .select("id, organization_id, bank_account_id, external_id, booked_at, amount, currency, transaction_type, description, source_hash")
      .eq("organization_id", organizationId)
      .eq("bank_account_id", bankAccountId)
      .eq("external_id", externalId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      organizationId: data.organization_id,
      bankAccountId: data.bank_account_id,
      externalId: data.external_id,
      bookedAt: data.booked_at,
      amount: Number(data.amount),
      currency: data.currency,
      type: data.transaction_type,
      description: data.description,
      sourceHash: data.source_hash,
    };
  }

  async createSession(input: Omit<ReconciliationSession, "id" | "status">): Promise<ReconciliationSession> {
    const client = this.clientFactory();
    const { data, error } = await client.from("reconciliation_sessions").insert({
      organization_id: input.organizationId,
      bank_account_id: input.bankAccountId,
      period_from: input.periodFrom,
      period_to: input.periodTo,
    }).select("id, organization_id, bank_account_id, period_from, period_to, status").single();
    if (error) throw error;
    return {
      id: data.id,
      organizationId: data.organization_id,
      bankAccountId: data.bank_account_id,
      periodFrom: data.period_from,
      periodTo: data.period_to,
      status: data.status,
    };
  }

  async recordMatch(sessionId: number, match: ReconciliationMatchRecord): Promise<void> {
    const client = this.clientFactory();
    const { error } = await client.from("reconciliation_matches").insert({
      session_id: sessionId,
      transaction_id: match.transactionId,
      target_type: match.targetType,
      target_id: match.targetId,
      confidence: match.confidence,
      rationale: match.rationale,
      confirmed_by: match.confirmedBy,
    });
    if (error) throw error;
  }

  async completeSession(sessionId: number): Promise<void> {
    const client = this.clientFactory();
    const { error } = await client.from("reconciliation_sessions")
      .update({ status: "completed" })
      .eq("id", sessionId)
      .eq("status", "open");
    if (error) throw error;
  }
}
