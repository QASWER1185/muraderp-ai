import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";
import { AssistantService } from "../src/ai-assistant/assistant.service.js";
import { DeterministicIntentResolver } from "../src/ai-assistant/deterministic-intent.resolver.js";

const context = { userId: "user-1", organizationId: "org-1" };

describe("AssistantService", () => {
  it("resolves a read request and uses the authorized read gateway", async () => {
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const gateway = {
      executeRead: vi.fn().mockResolvedValue("Receivables detail"),
      createDraft: vi.fn(),
    };
    const service = new AssistantService(auth, new DeterministicIntentResolver(), gateway);

    const response = await service.handle({ ...context, message: "Show receivables" });

    expect(response.intent).toBe("receivable.lookup");
    expect(response.decision).toBe("answer");
    expect(response.requiresConfirmation).toBe(false);
    expect(gateway.executeRead).toHaveBeenCalledOnce();
    expect(gateway.createDraft).not.toHaveBeenCalled();
  });

  it("requires confirmation for a mutation draft", async () => {
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const gateway = {
      executeRead: vi.fn(),
      createDraft: vi.fn().mockResolvedValue("Invoice draft INV-DRAFT-1 prepared for confirmation"),
    };
    const service = new AssistantService(auth, new DeterministicIntentResolver(), gateway);

    const response = await service.handle({ ...context, message: "Create an invoice" });

    expect(response.intent).toBe("invoice.create_draft");
    expect(response.decision).toBe("draft");
    expect(response.requiresConfirmation).toBe(true);
    expect(gateway.createDraft).toHaveBeenCalledOnce();
    expect(gateway.executeRead).not.toHaveBeenCalled();
  });

  it("rejects an unauthorized assistant action before gateway execution", async () => {
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(false) });
    const gateway = {
      executeRead: vi.fn(),
      createDraft: vi.fn(),
    };
    const service = new AssistantService(auth, new DeterministicIntentResolver(), gateway);

    await expect(service.handle({ ...context, message: "Show customer balance" })).rejects.toMatchObject({ status: 403 });
    expect(gateway.executeRead).not.toHaveBeenCalled();
    expect(gateway.createDraft).not.toHaveBeenCalled();
  });

  it("does not guess when intent is ambiguous", async () => {
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const gateway = {
      executeRead: vi.fn(),
      createDraft: vi.fn(),
    };
    const service = new AssistantService(auth, new DeterministicIntentResolver(), gateway);

    const response = await service.handle({ ...context, message: "hello" });

    expect(response.decision).toBe("clarify");
    expect(response.intent).toBeNull();
    expect(gateway.executeRead).not.toHaveBeenCalled();
    expect(gateway.createDraft).not.toHaveBeenCalled();
  });
});
