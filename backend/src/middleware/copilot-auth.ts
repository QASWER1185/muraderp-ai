import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { browserSessionHandler } from "../auth/browser-session.js";

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createCopilotAuth(internalToken?: string): RequestHandler {
  const browserAuth = browserSessionHandler(false);
  return (request, response, next) => {
    const authorization = request.header("authorization");
    const [scheme, token] = authorization?.split(" ", 2) ?? [];
    if (internalToken && scheme === "Bearer" && token && matches(token, internalToken)) { next(); return; }
    browserAuth(request, response, next);
  };
}
