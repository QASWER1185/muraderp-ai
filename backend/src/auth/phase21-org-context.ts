import type { RequestHandler } from "express";
import { ApiError } from "../errors/api-error.js";

export interface OrganizationContext {
  userId: string;
  organizationId: string;
  branchId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      organizationContext?: OrganizationContext;
    }
  }
}

/**
 * Compatibility boundary for older Phase 21 call sites.
 * Canonical authorization is organization-first; branch authorization must be
 * verified separately by TenantAccessService using an explicit branch grant.
 */
export const requireOrganizationContext: RequestHandler = (request, _response, next) => {
  const context = request.organizationContext;
  if (
    !context ||
    typeof context.userId !== "string" ||
    !context.userId.trim() ||
    typeof context.organizationId !== "string" ||
    !context.organizationId.trim()
  ) {
    next(
      new ApiError(
        401,
        "ORGANIZATION_CONTEXT_REQUIRED",
        "Authenticated organization context is required",
      ),
    );
    return;
  }
  next();
};

/**
 * Equality guard only. A null/absent active branch is never wildcard authority.
 * The context must already have been populated after an explicit branch grant
 * check by the canonical tenant-access service.
 */
export function assertBranchContext(
  context: OrganizationContext,
  branchId?: string | null,
): void {
  if (
    typeof branchId !== "string" ||
    !branchId.trim() ||
    typeof context.branchId !== "string" ||
    !context.branchId.trim() ||
    branchId.trim() !== context.branchId.trim()
  ) {
    throw new ApiError(
      403,
      "BRANCH_ACCESS_DENIED",
      "The requested branch is outside the verified branch context",
    );
  }
}
