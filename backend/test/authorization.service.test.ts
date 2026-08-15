import { describe, expect, it, vi } from "vitest";
import { AuthorizationService } from "../src/auth/authorization.service.js";

describe("AuthorizationService", () => {
  it("allows a permitted action", async () => {
    const gateway = { hasPermission: vi.fn().mockResolvedValue(true) };
    const service = new AuthorizationService(gateway);

    await expect(
      service.assertPermission("user-1", "org-1", "purchases.create"),
    ).resolves.toBeUndefined();
    expect(gateway.hasPermission).toHaveBeenCalledWith(
      "user-1",
      "org-1",
      "purchases.create",
    );
  });

  it("rejects a forbidden action with HTTP 403", async () => {
    const gateway = { hasPermission: vi.fn().mockResolvedValue(false) };
    const service = new AuthorizationService(gateway);

    await expect(
      service.assertPermission("user-1", "org-1", "accounting.post"),
    ).rejects.toMatchObject({ status: 403, message: "Forbidden" });
  });
});
