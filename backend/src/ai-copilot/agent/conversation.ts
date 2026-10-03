import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import type { AgentScope } from "./erp-tools.js";

const secret = env.INTERNAL_API_TOKEN ?? randomBytes(32).toString("hex");
type Turn = { user: string; assistant: string };
type Payload = { userId: string; organizationId: string; branchId: string; expires: number; turns: Turn[] };
const sign = (body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function readConversation(token: string | undefined, scope: AgentScope): Turn[] {
  if (!token || token.length > 9000) return [];
  const [body, signature] = token.split(".");
  if (!body || !signature) return [];
  const actual = Buffer.from(signature);
  const expected = Buffer.from(sign(body));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return [];
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Payload;
    if (data.userId !== scope.userId || data.organizationId !== scope.organizationId || data.branchId !== scope.branchId || data.expires < Date.now() || !Array.isArray(data.turns)) return [];
    return data.turns.slice(-3).filter((turn) => typeof turn.user === "string" && typeof turn.assistant === "string" && turn.user.length <= 500 && turn.assistant.length <= 1200);
  } catch { return []; }
}

export function writeConversation(scope: AgentScope, previous: Turn[], user: string, assistant: string): string {
  const payload: Payload = { ...scope, expires: Date.now() + 30 * 60_000, turns: [...previous, { user: user.slice(0, 500), assistant: assistant.slice(0, 1200) }].slice(-3) };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}
