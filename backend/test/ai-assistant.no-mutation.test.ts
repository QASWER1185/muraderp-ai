import { describe, expect, it } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";
import { AssistantService } from "../src/ai-assistant/assistant.service.js";
import { DeterministicIntentResolver } from "../src/ai-assistant/deterministic-intent.resolver.js";

describe("assistant mutation boundary", () => {
  it("never routes a draft request to the read gateway", async () => {
    const authorization = new AuthorizationService({ hasPermission: async () => true });
    const read = { executeRead: async () => "READ", createDraft: async () => "DRAFT" };
    const service = new AssistantService(authorization, new DeterministicIntentResolver(), read);
    const result = await service.handle({ userId: "u1", organizationId: "o1", message: "Create an invoice" });
    expect(result.decision).toBe("draft");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.message).toBe("DRAFT");
  });
});
