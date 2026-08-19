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
 * Phase 21 boundary adapter. Authentication/session verification is supplied by
 * the host application; this middleware only accepts an already verified
 * organization context and rejects requests that attempt to operate without it.
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

export function assertBranchContext(
  context: OrganizationContext,
  branchId?: string | null,
): void {
  // A null active branch intentionally represents organization-scoped access.
  // When an active branch exists, requested branch access must match it.
  if (branchId && context.branchId && branchId !== context.branchId) {
    throw new ApiError(
      403,
      "BRANCH_ACCESS_DENIED",
      "The requested branch is outside the active branch context",
    );
  }
}
