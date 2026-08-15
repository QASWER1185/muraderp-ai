import { describe, expect, it, vi } from "vitest";
import { BankReconciliationService, type BankTransaction } from "../src/services/bankReconciliation.service.js";
import type { BankReconciliationRepository } from "../src/repositories/bank-reconciliation.repository.js";

const transaction: BankTransaction = {
  organizationId: "org-1",
  externalId: "bank-001",
  bankAccountId: "acct-1",
  bookedAt: "2026-08-15T10:00:00.000Z",
  amount: 125000,
  currency: "PKR",
  type: "credit",
  description: "Ali Traders payment",
};

function repository(): BankReconciliationRepository {
  return {
    insertTransactions: vi.fn().mockResolvedValue([{ ...transaction, id: 1 }]),
    findTransactionByExternalId: vi.fn().mockResolvedValue({ ...transaction, id: 1 }),
    createSession: vi.fn().mockResolvedValue({ id: 10, organizationId: "org-1", bankAccountId: "acct-1", periodFrom: "2026-08-01", periodTo: "2026-08-31", status: "open" }),
    recordMatch: vi.fn().mockResolvedValue(undefined),
    completeSession: vi.fn().mockResolvedValue(undefined),
  };
}

describe("BankReconciliationService", () => {
  it("normalizes and rejects invalid bank transactions", () => {
    const service = new BankReconciliationService();
    expect(service.normalize(transaction).description).toBe("Ali Traders payment");
    expect(() => service.normalize({ ...transaction, amount: 0 })).toThrow("amount must be positive");
    expect(() => service.normalize({ ...transaction, bookedAt: "15-08-2026" })).toThrow("ISO timestamp");
  });

  it("deduplicates the same bank transaction identity", () => {
    const service = new BankReconciliationService();
    expect(service.deduplicate([transaction, transaction, { ...transaction, description: "duplicate feed row" }])).toHaveLength(1);
  });

  it("ingests only normalized unique transactions through the repository", async () => {
    const repo = repository();
    const service = new BankReconciliationService(repo);
    await service.ingest([transaction, transaction]);
    expect(repo.insertTransactions).toHaveBeenCalledTimes(1);
    expect(repo.insertTransactions).toHaveBeenCalledWith([transaction]);
  });

  it("opens a bounded reconciliation session", async () => {
    const repo = repository();
    const service = new BankReconciliationService(repo);
    await expect(service.openSession("org-1", "acct-1", { from: "2026-08-01", to: "2026-08-31" })).resolves.toMatchObject({ id: 10, status: "open" });
    expect(repo.createSession).toHaveBeenCalledWith({ organizationId: "org-1", bankAccountId: "acct-1", periodFrom: "2026-08-01", periodTo: "2026-08-31" });
    await expect(service.openSession("org-1", "acct-1", { from: "2026-09-01", to: "2026-08-31" })).rejects.toThrow("period is invalid");
  });

  it("requires explicit confirmation and records a verified match", async () => {
    const repo = repository();
    const service = new BankReconciliationService(repo);
    const suggestion = {
      transactionExternalId: "bank-001",
      targetType: "customer_receipt" as const,
      targetId: "receipt-44",
      confidence: 0.97,
      rationale: "Reference and amount match the customer receipt",
      requiresConfirmation: true as const,
    };
    await service.confirmMatch(10, transaction, suggestion, "user-7");
    expect(repo.recordMatch).toHaveBeenCalledWith(10, {
      transactionId: 1,
      targetType: "customer_receipt",
      targetId: "receipt-44",
      confidence: 0.97,
      rationale: "Reference and amount match the customer receipt",
      confirmedBy: "user-7",
    });
  });

  it("refuses to match a transaction that is not persisted", async () => {
    const repo = repository();
    vi.mocked(repo.findTransactionByExternalId).mockResolvedValue(null);
    const service = new BankReconciliationService(repo);
    await expect(service.confirmMatch(10, transaction, {
      transactionExternalId: "bank-001",
      targetType: "ledger_entry",
      targetId: "ledger-1",
      confidence: 0.9,
      rationale: "Validated ledger reference",
      requiresConfirmation: true,
    }, "user-7")).rejects.toThrow("was not found");
    expect(repo.recordMatch).not.toHaveBeenCalled();
  });

  it("completes only a valid reconciliation session id", async () => {
    const repo = repository();
    const service = new BankReconciliationService(repo);
    await service.completeSession(10);
    expect(repo.completeSession).toHaveBeenCalledWith(10);
    await expect(service.completeSession(0)).rejects.toThrow("session id is required");
  });

  it("never mutates accounting records directly", async () => {
    const repo = repository();
    const service = new BankReconciliationService(repo);
    await service.ingest([transaction]);
    await service.completeSession(10);
    expect(repo.recordMatch).not.toHaveBeenCalled();
    expect(repo.completeSession).toHaveBeenCalledTimes(1);
  });
});
