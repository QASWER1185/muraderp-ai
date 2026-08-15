import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";
import { createAssistantService } from "../src/ai-assistant/assistant.module.js";

describe("createAssistantService", () => {
  it("creates a working assistant service with the deterministic resolver", async () => {
    const auth = new AuthorizationService({ hasPermission: vi.fn().mockResolvedValue(true) });
    const gateway = { executeRead: vi.fn().mockResolvedValue("ok"), createDraft: vi.fn().mockResolvedValue("draft") };
    const service = createAssistantService(auth, gateway);
    const response = await service.handle({ userId: "u1", organizationId: "o1", message: "Show stock" });
    expect(response.intent).toBe("inventory.lookup");
    expect(response.message).toBe("ok");
  });
});
