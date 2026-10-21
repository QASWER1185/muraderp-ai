import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request {
      apiKeyAuth?: boolean;
    }
  }
}

function tokensMatch(providedToken: string, expectedToken: string): boolean {
  const provided = Buffer.from(providedToken, "utf8");
  const expected = Buffer.from(expectedToken, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/** Marks a request as API-key authenticated when its X-API-Key matches the configured secret.
 * Requests without a valid key continue to the existing session authentication boundary.
 */
export const apiKeyAuth: RequestHandler = (request, _response, next) => {
  const expectedKey = process.env.MURAD_API_KEY;
  const providedKey = request.header("X-API-Key");
  if (expectedKey && providedKey && tokensMatch(providedKey, expectedKey)) {
    request.apiKeyAuth = true;
  }
  next();
};
