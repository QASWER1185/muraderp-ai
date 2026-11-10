import { ApiError } from "../errors/api-error.js";
const SERVICE_PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const FORBIDDEN_DEFAULT_IDENTITIES = new Set([
    "backend",
    "default",
    "internal-system",
    "service-role",
    "service_role",
    "system",
]);
export function normalizeServicePrincipalId(value) {
    if (typeof value !== "string")
        return null;
    const normalized = value.trim();
    if (!SERVICE_PRINCIPAL_ID.test(normalized))
        return null;
    if (FORBIDDEN_DEFAULT_IDENTITIES.has(normalized.toLowerCase()))
        return null;
    return normalized;
}
export function createServicePrincipal(value) {
    const id = normalizeServicePrincipalId(value);
    return id ? Object.freeze({ kind: "internal-api", id }) : null;
}
export function requireServicePrincipal(principal) {
    if (!principal) {
        throw new ApiError(401, "SERVICE_PRINCIPAL_REQUIRED", "Authenticated backend service principal is required");
    }
    return principal;
}
//# sourceMappingURL=service-principal.js.map