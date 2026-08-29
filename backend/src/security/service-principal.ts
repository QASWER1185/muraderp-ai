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

export interface ServicePrincipal {
  readonly kind: "internal-api";
  readonly id: string;
}

export function normalizeServicePrincipalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!SERVICE_PRINCIPAL_ID.test(normalized)) return null;
  if (FORBIDDEN_DEFAULT_IDENTITIES.has(normalized.toLowerCase())) return null;
  return normalized;
}

export function createServicePrincipal(value: unknown): ServicePrincipal | null {
  const id = normalizeServicePrincipalId(value);
  return id ? Object.freeze({ kind: "internal-api" as const, id }) : null;
}

export function requireServicePrincipal(principal: ServicePrincipal | undefined): ServicePrincipal {
  if (!principal) {
    throw new ApiError(
      401,
      "SERVICE_PRINCIPAL_REQUIRED",
      "Authenticated backend service principal is required",
    );
  }
  return principal;
}

declare global {
  namespace Express {
    interface Request {
      servicePrincipal?: ServicePrincipal;
    }
  }
}
