import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors/api-error.js";
import { requireServicePrincipal } from "../security/service-principal.js";
const uuid = z.string().uuid();
function requiredUuidHeader(request, name) {
    const contextValue = name === "X-Organization-Id" ? request.apiKeyTenantContext?.organizationId
        : name === "X-Branch-Id" ? request.apiKeyTenantContext?.branchId
            : name === "X-Actor-User-Id" ? request.apiKeyTenantContext?.actorUserId : undefined;
    const value = contextValue ?? request.header(name)?.trim();
    const parsed = uuid.safeParse(value);
    if (!parsed.success) {
        throw new ApiError(400, "TRANSACTION_CONTEXT_REQUIRED", `${name} must be a valid UUID`);
    }
    return parsed.data;
}
export function requireAuthoritativeTransactionIdentity(request) {
    const principal = requireServicePrincipal(request.servicePrincipal);
    return {
        organizationId: requiredUuidHeader(request, "X-Organization-Id"),
        branchId: requiredUuidHeader(request, "X-Branch-Id"),
        actorUserId: requiredUuidHeader(request, "X-Actor-User-Id"),
        servicePrincipalId: principal.id,
    };
}
export function authoritativeRequestFingerprint(identity, operation, payload) {
    const canonical = JSON.stringify({
        organization_id: identity.organizationId,
        branch_id: identity.branchId,
        actor_user_id: identity.actorUserId,
        operation_scope: operation,
        payload,
    });
    return createHash("sha256").update(canonical, "utf8").digest("hex");
}
//# sourceMappingURL=authoritative-transaction-context.js.map