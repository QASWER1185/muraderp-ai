import { createHash } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { requireServicePrincipal } from "../security/service-principal.js";
import type { AuthoritativeTransactionIdentity } from "../types/authoritative-transaction.types.js";

const uuid = z.string().uuid();

function requiredUuidHeader(request: Request, name: string): string {
  const value = request.header(name)?.trim();
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "TRANSACTION_CONTEXT_REQUIRED", `${name} must be a valid UUID`);
  }
  return parsed.data;
}

export function requireAuthoritativeTransactionIdentity(
  request: Request,
): AuthoritativeTransactionIdentity {
  const principal = requireServicePrincipal(request.servicePrincipal);
  return {
    organizationId: requiredUuidHeader(request, "X-Organization-Id"),
    branchId: requiredUuidHeader(request, "X-Branch-Id"),
    actorUserId: requiredUuidHeader(request, "X-Actor-User-Id"),
    servicePrincipalId: principal.id,
  };
}

export function authoritativeRequestFingerprint(
  identity: AuthoritativeTransactionIdentity,
  operation: string,
  payload: unknown,
): string {
  const canonical = JSON.stringify({
    organization_id: identity.organizationId,
    branch_id: identity.branchId,
    actor_user_id: identity.actorUserId,
    operation_scope: operation,
    payload,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
