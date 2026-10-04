import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import type { AgentScope } from "./erp-tools.js";

const secret = env.INTERNAL_API_TOKEN ?? randomBytes(32).toString("hex");
export type ProductReference = { id: number; name: string; sku: string; unit: string };
export type ProductContext = { candidates: ProductReference[]; ambiguous: boolean };
export type Turn = { user: string; assistant: string; productContext?: ProductContext };
type Payload = { userId: string; organizationId: string; branchId: string; expires: number; turns: Turn[] };
const sign = (body: string) => createHmac("sha256", secret).update(body).digest("base64url");

function safeProductContext(value: unknown): ProductContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<ProductContext>;
  if (!Array.isArray(raw.candidates)) return undefined;
  const candidates = raw.candidates.filter((item): item is ProductReference =>
    !!item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.name === "string" && typeof item.sku === "string" && typeof item.unit === "string",
  ).slice(0, 5).map((item) => ({ id: item.id, name: item.name.slice(0, 160), sku: item.sku.slice(0, 100), unit: item.unit.slice(0, 30) }));
  if (!candidates.length) return undefined;
  return { candidates, ambiguous: raw.ambiguous === true || raw.candidates.length > 1 };
}

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
    return data.turns.slice(-3).filter((turn) => typeof turn.user === "string" && typeof turn.assistant === "string" && turn.user.length <= 500 && turn.assistant.length <= 1200)
      .map((turn) => {
        const productContext = safeProductContext(turn.productContext);
        return { user: turn.user, assistant: turn.assistant, ...(productContext ? { productContext } : {}) };
      });
  } catch { return []; }
}

export function writeConversation(scope: AgentScope, previous: Turn[], user: string, assistant: string, productContext?: ProductContext): string {
  const safe = safeProductContext(productContext);
  const payload: Payload = { ...scope, expires: Date.now() + 30 * 60_000, turns: [...previous.map(({ user: priorUser, assistant: priorAssistant }) => ({ user: priorUser, assistant: priorAssistant })), { user: user.slice(0, 500), assistant: assistant.slice(0, 1200), ...(safe ? { productContext: safe } : {}) }].slice(-3) };
  let body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  // Multibyte messages must fit the same bound enforced by the HTTP route.
  while (body.length + 44 > 9000) {
    if (payload.turns.length > 1) payload.turns.shift();
    else {
      const latest = payload.turns[0]!;
      if (latest.assistant.length) latest.assistant = latest.assistant.slice(0, Math.max(0, latest.assistant.length - 200));
      else latest.user = latest.user.slice(0, Math.max(0, latest.user.length - 100));
    }
    body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }
  return `${body}.${sign(body)}`;
}
