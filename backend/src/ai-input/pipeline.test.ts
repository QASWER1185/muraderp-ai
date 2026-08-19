import { describe, expect, it } from "vitest";
import type { AiInputDraft, AiInputProvider, AiInputRequest } from "./ai-input.types.js";
import { AiInputPipeline, InMemoryAiInputGateway } from "./pipeline.js";

const provider: AiInputProvider = {
  async extract(request) {
    const source = request.source;
    return {
      draftId: "provider-controlled-id-must-not-be-trusted",
      source,
      intent: request.intent,
      organizationId: request.organizationId,
      userId: "spoofed-provider-user",
      status: "confirmed",
      requiresConfirmation: true,
      fields: {
        product: { value: "Bestway Cement", confidence: 0.98, source },
        quantity: { value: 10, confidence: 0.99, source },
        unitRate: { value: 1450, confidence: 0.91, source },
      },
    } satisfies AiInputDraft;
  },
};

function requestFor(source: AiInputRequest["source"]): AiInputRequest {
  const request: AiInputRequest = {
    source,
    intent: "supplier_bill.create",
    organizationId: "org-1",
    userId: "user-1",
  };
  if (source === "text" || source === "voice") request.text = "10 bags";
  if (source === "image" || source === "camera") request.mediaReference = "media-1";
  return request;
}

describe("Phase 18 AI draft normalization and ownership", () => {
  it("creates a server-owned reviewable draft regardless of provider metadata", async () => {
    const gateway = new InMemoryAiInputGateway();
    const pipeline = new AiInputPipeline(provider, gateway);
    const draft = await pipeline.createDraft(requestFor("text"));

    expect(draft.draftId).not.toBe("provider-controlled-id-must-not-be-trusted");
    expect(draft.status).toBe("draft");
    expect(draft.requiresConfirmation).toBe(true);
    expect(draft.organizationId).toBe("org-1");
    expect(draft.userId).toBe("user-1");
    expect(draft.source).toBe("text");
    expect(draft.intent).toBe("supplier_bill.create");
  });

  it("requires validation before confirmation and enforces user ownership", async () => {
    const gateway = new InMemoryAiInputGateway();
    const pipeline = new AiInputPipeline(provider, gateway);
    const draft = await pipeline.createDraft(requestFor("text"));

    await expect(pipeline.confirmDraft(draft.draftId, "org-1", "user-2")).rejects.toThrow(
      "user ownership mismatch",
    );

    await expect(pipeline.confirmDraft(draft.draftId, "org-1", "user-1")).rejects.toThrow(
      "must be validated",
    );

    const validated = await pipeline.validateDraft(draft.draftId, "org-1");
    expect(validated.status).toBe("validated");
    await pipeline.confirmDraft(draft.draftId, "org-1", "user-1");
    expect((await gateway.getDraft(draft.draftId))?.status).toBe("confirmed");
  });

  it("blocks cross-organization draft access", async () => {
    const pipeline = new AiInputPipeline(provider, new InMemoryAiInputGateway());
    const draft = await pipeline.createDraft({
      source: "voice",
      intent: "inventory.adjust",
      organizationId: "org-1",
      userId: "user-1",
      text: "adjust stock",
    });

    await expect(pipeline.validateDraft(draft.draftId, "org-2")).rejects.toThrow(
      "organization mismatch",
    );
  });

  it("rejects malformed input before calling the provider", async () => {
    let called = false;
    const guardedProvider: AiInputProvider = {
      async extract() {
        called = true;
        return provider.extract(requestFor("text"));
      },
    };
    const pipeline = new AiInputPipeline(guardedProvider, new InMemoryAiInputGateway());

    await expect(
      pipeline.createDraft({
        source: "text",
        intent: "estimate.create",
        organizationId: "",
        userId: "user-1",
        text: "estimate",
      }),
    ).rejects.toThrow("organization and user context");
    expect(called).toBe(false);
  });

  it("rejects runtime-invalid source and intent values", async () => {
    const guardedProvider: AiInputProvider = {
      async extract() {
        throw new Error("provider must not be called");
      },
    };
    const pipeline = new AiInputPipeline(guardedProvider, new InMemoryAiInputGateway());
    const sourceRequest = { ...requestFor("text"), source: "fax" } as unknown as AiInputRequest;
    const intentRequest = { ...requestFor("text"), intent: "payments.execute" } as unknown as AiInputRequest;

    await expect(pipeline.createDraft(sourceRequest)).rejects.toThrow("Unsupported AI input source");
    await expect(pipeline.createDraft(intentRequest)).rejects.toThrow("Unsupported AI input intent");
  });
});
