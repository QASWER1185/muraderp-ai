import { afterEach, describe, expect, it, vi } from "vitest";
import { askCopilot, confirmCopilotDraft, createCopilotDraft, createCopilotFinancialDraft, createCopilotMasterDataDraft, createCopilotRateListDraft, extractInvoiceDocument, getCopilotProviderStatus } from "./copilot-api.js";
import { clearCopilotApiKey, saveCopilotApiKey } from "./copilot-key.js";

afterEach(() => { vi.unstubAllGlobals(); clearCopilotApiKey(); });

function response(body = {}) {
  return { ok: true, json: async () => body };
}

describe("Copilot browser API tenant context", () => {
  it("sends the next read to the Phase 1 agent with signed conversation context", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { answer: "PKR 477", conversationToken: "new-token" } }));
    vi.stubGlobal("fetch", fetch);
    await askCopilot("اس کا موجودہ سیل ریٹ بتاؤ، مقدار 1 میٹر", "org-1", "branch-1", "signed-token");
    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/agent", expect.objectContaining({
      credentials: "include",
      headers: expect.objectContaining({ "X-Organization-Id": "org-1", "X-Branch-Id": "branch-1" }),
      body: JSON.stringify({ message: "اس کا موجودہ سیل ریٹ بتاؤ، مقدار 1 میٹر", conversationToken: "signed-token" }),
    }));
  });
  it("sends a saved Gemini key only as request headers to the Copilot API", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { answer: "Verified" } }));
    vi.stubGlobal("fetch", fetch);
    const values = new Map();
    vi.stubGlobal("localStorage", { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) });
    saveCopilotApiKey("AIzaSyExampleKeyForCopilot123456789");

    await askCopilot("Pipe stock", "org-1", "branch-1");

    expect(fetch.mock.calls[0][1].headers).toMatchObject({
      "X-Api-Key": "AIzaSyExampleKeyForCopilot123456789",
      "X-AI-Provider": "gemini",
    });
    expect(fetch.mock.calls[0][1].body).not.toContain("AIzaSyExampleKeyForCopilot123456789");
  });
  it("reads the server key availability status without requiring Copilot model configuration", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: { serverConfigured: false } }));
    vi.stubGlobal("fetch", fetch);
    await getCopilotProviderStatus();
    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/copilot/settings", expect.objectContaining({ method: "GET", credentials: "include" }));
  });
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
