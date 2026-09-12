import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmCopilotDraft, createCopilotDraft, createCopilotFinancialDraft, createCopilotMasterDataDraft, createCopilotRateListDraft, extractInvoiceDocument } from "./copilot-api.js";

afterEach(() => vi.unstubAllGlobals());

function response(body = {}) {
  return { ok: true, json: async () => body };
}

describe("Copilot browser API tenant context", () => {
  it("carries branch context when creating a proposal draft", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "draft-1" } }));
    vi.stubGlobal("fetch", fetch);

    await createCopilotDraft({ organizationId: "org-1", intent: "estimate" }, "branch-1");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/drafts", expect.objectContaining({
      headers: expect.objectContaining({ "X-Branch-Id": "branch-1" }),
    }));
  });

  it("uses the caller's idempotency key when a reviewed draft will be confirmed", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "draft-1" } }));
    vi.stubGlobal("fetch", fetch);

    await createCopilotDraft({ organizationId: "org-1", intent: "estimate" }, "branch-1", "copilot-draft-fixed");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/drafts", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "copilot-draft-fixed" }),
    }));
  });

  it("preserves the reviewed master-data draft idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "draft-2" } }));
    vi.stubGlobal("fetch", fetch);

    await createCopilotMasterDataDraft({ organizationId: "org-1", intent: "customer_create", name: "Acme" }, "branch-1", "customer-fixed");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/master-data/drafts", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "customer-fixed" }),
    }));
  });

  it("preserves the reviewed Rate List draft idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "draft-3" } }));
    vi.stubGlobal("fetch", fetch);

    await createCopilotRateListDraft({ organizationId: "org-1", rateListId: 7, versionNumber: 2 }, "branch-1", "rate-list-fixed");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/rate-list/drafts", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "rate-list-fixed" }),
    }));
  });

  it("preserves the reviewed financial draft idempotency key", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { id: "draft-4" } }));
    vi.stubGlobal("fetch", fetch);

    await createCopilotFinancialDraft({ organizationId: "org-1", intent: "customer_payment", amount: 500 }, "branch-1", "payment-fixed");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/financial/drafts", expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "payment-fixed" }),
    }));
  });

  it("uses the extraction-only Invoice endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { extractionOnly: true, executable: false } }));
    vi.stubGlobal("fetch", fetch);

    await extractInvoiceDocument({ organizationId: "org-1", source: "text", text: "invoice text" }, "branch-1");

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/extract/invoice", expect.objectContaining({
      headers: expect.objectContaining({ "X-Branch-Id": "branch-1" }),
    }));
  });

  it("preserves organization, branch, actor, and idempotency context on confirmation", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ executed: true }));
    vi.stubGlobal("fetch", fetch);

    await confirmCopilotDraft({
      id: "draft-1",
      organizationId: "org-1",
      branchId: "branch-1",
      userId: "user-1",
      idempotencyKey: "idem-1",
    });

    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/drafts/draft-1/confirm", expect.objectContaining({
      headers: expect.objectContaining({
        "X-Organization-Id": "org-1",
        "X-Branch-Id": "branch-1",
        "X-User-Id": "user-1",
        "Idempotency-Key": "idem-1",
      }),
    }));
  });
});
