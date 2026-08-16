import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { env } from "../config/env.js";

const COOKIE_NAME = "muraderp_session";
const SESSION_TTL_SECONDS = 60 * 60;
const TEST_SIGNING_SECRET = "muraderp-phase23-test-session-secret";
type SessionPayload = { userId: string; exp: number };

function signingSecret(): string {
  if (env.INTERNAL_API_TOKEN) return env.INTERNAL_API_TOKEN;
  if (env.NODE_ENV === "test") return TEST_SIGNING_SECRET;
  throw new Error("INTERNAL_API_TOKEN is required for browser sessions");
}
function sign(value: string): string { return createHmac("sha256", signingSecret()).update(value).digest("base64url"); }
function encode(payload: SessionPayload): string { const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"); return `${body}.${sign(body)}`; }
function decode(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split(".", 2); if (!body || !signature) return null;
  const expected = sign(body); const actualBuffer = Buffer.from(signature); const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  try { const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload; if (!payload.userId || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null; return payload; } catch { return null; }
}
function cookieValue(request: Request): string | undefined {
  const header = request.header("cookie"); if (!header) return undefined;
  for (const part of header.split(";")) { const [name, ...rest] = part.trim().split("="); if (name === COOKIE_NAME) return rest.join("="); }
  return undefined;
}
export type BrowserPrincipal = { userId: string };
declare global { namespace Express { interface Request { browserPrincipal?: BrowserPrincipal; } } }
export function browserSessionHandler(required = true): RequestHandler {
  return (request: Request, response: Response, next: NextFunction) => {
    const session = decode(cookieValue(request));
    if (!session) { if (required) response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid browser session is required" } }); else next(); return; }
    request.browserPrincipal = { userId: session.userId }; next();
  };
}
export async function bootstrapBrowserSession(accessToken: string, response: Response): Promise<{ userId: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error("Supabase configuration is required for browser sessions");
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Invalid or expired Supabase session");
  const userId = data.user.id; const payload: SessionPayload = { userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  response.cookie(COOKIE_NAME, encode(payload), { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_TTL_SECONDS * 1000 });
  return { userId };
}
export function clearBrowserSession(response: Response): void { response.clearCookie(COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" }); }
