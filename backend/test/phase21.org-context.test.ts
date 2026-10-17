import { describe, expect, it, vi } from "vitest";
import {
  assertBranchContext,
  requireOrganizationContext,
  type OrganizationContext,
} from "../src/auth/phase21-org-context.js";

const context: OrganizationContext = {
  userId: "user-1",
  organizationId: "org-1",
  branchId: "branch-1",
};

describe("Phase 21 compatibility context boundary", () => {
  it("accepts a verified organization context", () => {
    const request = { organizationContext: context } as never;
    const next = vi.fn();
    requireOrganizationContext(request, {} as never, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects missing organization context", () => {
    const request = {} as never;
    const next = vi.fn();
    requireOrganizationContext(request, {} as never, next);
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 401, code: "ORGANIZATION_CONTEXT_REQUIRED" });
  });

  it("accepts only the explicitly verified active branch", () => {
    expect(() => assertBranchContext(context, "branch-1")).not.toThrow();
  });

  it("rejects a different branch", () => {
    expect(() => assertBranchContext(context, "branch-2")).toThrow("outside the verified branch context");
  });

  it("rejects null active branch instead of treating it as wildcard", () => {
    expect(() => assertBranchContext({ ...context, branchId: null }, "branch-1")).toThrow("outside the verified branch context");
  });

  it("rejects missing requested branch", () => {
    expect(() => assertBranchContext(context, null)).toThrow("outside the verified branch context");
  });
});
