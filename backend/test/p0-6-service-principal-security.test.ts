import { describe, expect, it, vi } from "vitest";
import { createInternalApiAuth } from "../src/middleware/internal-api-auth.js";
import { createServicePrincipal, normalizeServicePrincipalId } from "../src/security/service-principal.js";

describe("P0-6 service-principal boundary", () => {
  it("rejects generic/default service identities", () => {
    for (const value of ["internal-system", "backend", "service_role", "default", "system"]) {
      expect(normalizeServicePrincipalId(value)).toBeNull();
    }
  });

  it("accepts an explicit named service principal", () => {
    expect(createServicePrincipal("muraderp-api-prod-01")).toEqual({ kind: "internal-api", id: "muraderp-api-prod-01" });
  });

  it("fails closed when a token exists without a configured service identity", () => {
    const middleware = createInternalApiAuth("t".repeat(64), "internal-system");
    const request = { header: vi.fn().mockReturnValue(`Bearer ${"t".repeat(64)}`) } as never;
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnValue({ json }) } as never;
    const next = vi.fn();
    middleware(request, response, next);
    expect(next).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: "ERP_NOT_CONFIGURED" }) }));
  });

  it("attaches only the server-configured principal after a valid credential", () => {
    const token = "t".repeat(64);
    const middleware = createInternalApiAuth(token, "muraderp-api-prod-01");
    const request = { header: vi.fn().mockImplementation((name: string) => name === "authorization" ? `Bearer ${token}` : "attacker-principal") } as any;
    const response = { status: vi.fn() } as never;
    const next = vi.fn();
    middleware(request, response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(request.servicePrincipal).toEqual({ kind: "internal-api", id: "muraderp-api-prod-01" });
  });

  it("does not attach a principal for an invalid credential", () => {
    const middleware = createInternalApiAuth("t".repeat(64), "muraderp-api-prod-01");
    const request = { header: vi.fn().mockReturnValue(`Bearer ${"x".repeat(64)}`) } as any;
    const json = vi.fn();
    const response = { status: vi.fn().mockReturnValue({ json }) } as never;
    const next = vi.fn();
    middleware(request, response, next);
    expect(next).not.toHaveBeenCalled();
    expect(request.servicePrincipal).toBeUndefined();
  });
});
