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

function request(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org-1",
    userId: "user-1",
    transactionType: "ESTIMATE" as const,
    draft: draft(),
    idempotencyKey: "estimate-001",
    ...overrides,
  };
}

describe("Phase 19 transaction automation", () => {
  it("prepares a confirmed estimate without directly mutating financial data", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const result = await service.prepare(request());

    expect(result.created).toBe(true);
    expect(result.command.status).toBe("READY");
    expect(result.command.requiresConfirmation).toBe(true);
    expect(result.command.transactionType).toBe("ESTIMATE");
  });

  it("keeps unconfirmed drafts in review", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const result = await service.prepare(request({
      idempotencyKey: "estimate-002",
      draft: draft({ status: "needs_review" }),
    }));

    expect(result.command.status).toBe("REQUIRES_REVIEW");
  });

  it("rejects a mismatched document type", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    await expect(service.prepare(request({
      transactionType: "SUPPLIER_BILL",
      idempotencyKey: "bill-001",
    }))).rejects.toMatchObject({ code: "DOCUMENT_TYPE_MISMATCH" });
  });

  it("enforces organization and user boundaries", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    await expect(service.prepare(request({
      organizationId: "org-2",
      idempotencyKey: "estimate-003",
    }))).rejects.toMatchObject({ code: "ORGANIZATION_BOUNDARY_VIOLATION" });

    await expect(service.prepare(request({
      userId: "user-2",
      idempotencyKey: "estimate-004",
    }))).rejects.toMatchObject({ code: "USER_CONTEXT_MISMATCH" });
  });

  it("is idempotent and rejects reuse with a different payload", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const first = await service.prepare(request({ idempotencyKey: "estimate-005" }));
    const second = await service.prepare(request({ idempotencyKey: "estimate-005" }));

    expect(second.created).toBe(false);
    expect(second.command.requestFingerprint).toBe(first.command.requestFingerprint);

    await expect(service.prepare(request({
      idempotencyKey: "estimate-005",
      draft: draft({ extractedFields: { lines: [{ item: "Dura Pipe 32mm", quantity: 30 }] } }),
    }))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
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
      const result = await service.prepare(request({
        transactionType,
        draft: draft({ documentType }),
        idempotencyKey: `transaction-${transactionType}`,
      }));
      expect(result.command.status).toBe("READY");
      expect(result.command.sourceDocumentType).toBe(documentType);
    }
  });

  it("rejects runtime-invalid transaction types before document matching", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    await expect(service.prepare(request({
      transactionType: "PAYMENT_EXECUTE",
      idempotencyKey: "invalid-type",
    }))).rejects.toMatchObject({ code: "UNSUPPORTED_TRANSACTION_TYPE" });
  });

  it("rejects malformed runtime requests instead of throwing incidental TypeErrors", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());

    await expect(service.prepare(null as never)).rejects.toMatchObject({ code: "TRANSACTION_REQUEST_INVALID" });
    await expect(service.prepare(request({ idempotencyKey: 123 }))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(service.prepare(request({ idempotencyKey: "   " }))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    await expect(service.prepare(request({ idempotencyKey: "x".repeat(256) }))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_TOO_LONG" });
  });

  it("rejects malformed document drafts safely", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());

    await expect(service.prepare(request({ draft: null }))).rejects.toMatchObject({ code: "DOCUMENT_DRAFT_INVALID" });
    await expect(service.prepare(request({ draft: { ...draft(), matches: "bad" } }))).rejects.toMatchObject({ code: "DOCUMENT_DRAFT_INVALID" });
    await expect(service.prepare(request({ draft: { ...draft(), extractedFields: [] } }))).rejects.toMatchObject({ code: "DOCUMENT_DRAFT_INVALID" });
  });

  it("does not mutate the authoritative ERP state", async () => {
    const service = new TransactionAutomationService(new InMemoryTransactionCommandStore());
    const result = await service.prepare(request({ idempotencyKey: "no-mutation-001" }));

    expect(result.command.status).toBe("READY");
    expect(result.command.requiresConfirmation).toBe(true);
  });
});
