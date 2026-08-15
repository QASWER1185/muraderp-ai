import { describe, expect, it } from "vitest";
import type { DocumentDraft } from "../types/document-intelligence.types.js";
import { TransactionAutomationService, InMemoryTransactionCommandStore } from "./transaction-automation.service.js";

function draft(overrides: Partial<DocumentDraft> = {}): DocumentDraft {
  return {
    organizationId: "org-1",
    createdByUserId: "user-1",
    documentType: "estimate",
    status: "confirmed",
    provenance: { source: "text", extractedAt: "2026-08-15T12:00:00.000Z" },
    extractedFields: { lines: [{ item: "Popular Pipe 25mm", quantity: 50 }] },
    matches: [{ entityType: "product", inputValue: "Popular Pipe 25mm", matchedId: "101", confidence: 0.99 }],
    confidence: 0.99,
    requiresConfirmation: true,
    ...overrides,
  };
}

describe("Phase 19 transaction automation", () => {
  it("prepares a confirmed estimate without directly mutating financial data", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const result = await service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft(),
      idempotencyKey: "estimate-001",
    });

    expect(result.created).toBe(true);
    expect(result.command.status).toBe("READY");
    expect(result.command.requiresConfirmation).toBe(true);
    expect(result.command.transactionType).toBe("ESTIMATE");
  });

  it("keeps unconfirmed drafts in review", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const result = await service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft({ status: "needs_review" }),
      idempotencyKey: "estimate-002",
    });

    expect(result.command.status).toBe("REQUIRES_REVIEW");
  });

  it("rejects a mismatched document type", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    await expect(service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "SUPPLIER_BILL",
      draft: draft(),
      idempotencyKey: "bill-001",
    })).rejects.toMatchObject({ code: "DOCUMENT_TYPE_MISMATCH" });
  });

  it("enforces organization and user boundaries", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    await expect(service.prepare({
      organizationId: "org-2",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft(),
      idempotencyKey: "estimate-003",
    })).rejects.toMatchObject({ code: "ORGANIZATION_BOUNDARY_VIOLATION" });

    await expect(service.prepare({
      organizationId: "org-1",
      userId: "user-2",
      transactionType: "ESTIMATE",
      draft: draft(),
      idempotencyKey: "estimate-004",
    })).rejects.toMatchObject({ code: "USER_CONTEXT_MISMATCH" });
  });

  it("is idempotent and rejects reuse with a different payload", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const first = await service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft(),
      idempotencyKey: "estimate-005",
    });
    const second = await service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft(),
      idempotencyKey: "estimate-005",
    });

    expect(second.created).toBe(false);
    expect(second.command.requestFingerprint).toBe(first.command.requestFingerprint);

    await expect(service.prepare({
      organizationId: "org-1",
      userId: "user-1",
      transactionType: "ESTIMATE",
      draft: draft({ extractedFields: { lines: [{ item: "Dura Pipe 32mm", quantity: 30 }] } }),
      idempotencyKey: "estimate-005",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("supports the planned transaction document types", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const cases = [
      ["CUSTOMER_INVOICE", "customer_invoice"],
      ["SUPPLIER_BILL", "supplier_bill"],
      ["CUSTOMER_RETURN", "customer_return"],
      ["PURCHASE_RETURN", "purchase_return"],
      ["INVENTORY_COUNT", "inventory_count"],
    ] as const;

    for (const [transactionType, documentType] of cases) {
      const result = await service.prepare({
        organizationId: "org-1",
        userId: "user-1",
        transactionType,
        draft: draft({ documentType }),
        idempotencyKey: `transaction-${transactionType}`,
      });
      expect(result.command.status).toBe("READY");
      expect(result.command.sourceDocumentType).toBe(documentType);
    }
  });
});
