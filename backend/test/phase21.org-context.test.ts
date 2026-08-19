import { describe, expect, it } from "vitest";
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

describe("Phase 21 organization and branch context boundary", () => {
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

    expect(next).toHaveBeenCalledOnce();
    expect(next.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 401,
      code: "ORGANIZATION_CONTEXT_REQUIRED",
    });
  });

  it("accepts the active branch", () => {
    expect(() => assertBranchContext(context, "branch-1")).not.toThrow();
  });

  it("rejects a different branch", () => {
    expect(() => assertBranchContext(context, "branch-2")).toThrow("BRANCH_ACCESS_DENIED");
  });

  it("rejects a requested branch when no active branch is selected", () => {
    expect(() =>
      assertBranchContext({ ...context, branchId: null }, "branch-1"),
    ).toThrow("BRANCH_ACCESS_DENIED");
  });
});
