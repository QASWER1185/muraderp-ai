import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { createServicePrincipal } from "../security/service-principal.js";

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function createInternalApiAuth(
  expectedToken?: string,
  servicePrincipalId?: string,
): RequestHandler {
  const servicePrincipal = createServicePrincipal(servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);

  return (request, response, next) => {
    if (!expectedToken || !servicePrincipal) {
      response.status(503).json({
        error: { code: "ERP_NOT_CONFIGURED", message: "Privileged backend service principal is not configured" },
      });
      return;
    }

    const authorization = request.header("authorization");
    const [scheme, providedToken] = authorization?.split(" ", 2) ?? [];
    if (scheme !== "Bearer" || !providedToken || !tokensMatch(providedToken, expectedToken)) {
      response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid internal API token is required" } });
      return;
    }

    request.servicePrincipal = servicePrincipal;
    const requestLog = (request as typeof request & { log?: { info(bindings: Record<string, unknown>, message: string): void } }).log;
    requestLog?.info({ servicePrincipalId: servicePrincipal.id }, "Backend service principal authenticated");
    next();
  };
}
