import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmCopilotDraft, createCopilotDraft } from "./copilot-api.js";

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
