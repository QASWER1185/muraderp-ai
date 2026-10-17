import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { browserSessionHandler } from "../auth/browser-session.js";
import { env } from "../config/env.js";
import { createServicePrincipal } from "../security/service-principal.js";

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCopilotAuth(internalToken?: string, servicePrincipalId?: string): RequestHandler {
  const browserAuth = browserSessionHandler(true);
  const servicePrincipal = createServicePrincipal(servicePrincipalId ?? env.INTERNAL_API_PRINCIPAL_ID);
  return (request, response, next) => {
    const authorization = request.header("authorization");
    const [scheme, token] = authorization?.split(" ", 2) ?? [];
    if (internalToken && scheme === "Bearer" && token && matches(token, internalToken)) {
      if (!servicePrincipal) {
        response.status(503).json({ error: { code: "ERP_NOT_CONFIGURED", message: "Privileged backend service principal is not configured" } });
        return;
      }
      request.servicePrincipal = servicePrincipal;
      const requestLog = (request as typeof request & { log?: { info(bindings: Record<string, unknown>, message: string): void } }).log;
      requestLog?.info({ servicePrincipalId: servicePrincipal.id }, "Backend service principal authenticated");
      next();
      return;
    }
    browserAuth(request, response, next);
  };
}
