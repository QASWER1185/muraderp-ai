import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken);
  const expected = Buffer.from(expectedToken);

  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function createInternalApiAuth(expectedToken?: string): RequestHandler {
  return (request, response, next) => {
    if (!expectedToken) {
      response.status(503).json({
        error: {
          code: "ERP_NOT_CONFIGURED",
          message: "Database-backed ERP routes are not configured",
        },
      });
      return;
    }

    const authorization = request.header("authorization");
    const [scheme, providedToken] = authorization?.split(" ", 2) ?? [];

    if (scheme !== "Bearer" || !providedToken || !tokensMatch(providedToken, expectedToken)) {
      response.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "A valid internal API token is required",
        },
      });
      return;
    }

    next();
  };
}
