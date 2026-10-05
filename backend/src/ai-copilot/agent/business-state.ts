import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../../errors/api-error.js";
import { readConversation, signConversationPayload, verifyConversationPayload } from "./conversation.js";
import type { AgentScope } from "./erp-tools.js";
import { paymentStateSchema } from "./payment-state.js";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const product = z.strictObject({ id, name: z.string().max(160), sku: z.string().max(100), unit: z.string().max(30) });
export const draftLineSchema = z.strictObject({
  id: z.string().uuid(), productId: id, quantity: z.number().finite().positive().max(1_000_000),
  unit: z.string().min(1).max(30), discountPercent: z.number().finite().min(0).max(100),
  rateListId: id.optional(),
});
export const businessStateSchema = z.strictObject({
  version: z.literal(2), conversationId: z.string().uuid(),
  userId: z.string().min(1), organizationId: z.string().min(1), branchId: z.string().min(1),
  expires: z.number().int(), revision: z.number().int().nonnegative(),
  // A display/model hint only. It never supplies entity, price, or permission authority.
  lastMessage: z.string().max(500).optional(),
  productContext: z.strictObject({ candidates: z.array(product).max(5), ambiguous: z.boolean() }).optional(),
  customer: z.strictObject({ id, name: z.string().max(160) }).optional(),
  vendor: z.strictObject({ id, name: z.string().max(160) }).optional(),
  vendorAmbiguous: z.boolean().optional(),
  comparison: z.array(product).min(2).max(5).optional(),
  analysis: z.strictObject({ productId: id, quantity: z.number().finite().positive().max(1_000_000), discountPercent: z.number().finite().min(0).max(100) }).optional(),
  paymentPreparation: paymentStateSchema.optional(),
  customerAmbiguous: z.boolean().optional(), productUnresolved: z.boolean().optional(),
  brandHint: z.string().max(120).optional(), rateListId: id.optional(),
  draft: z.strictObject({
    id: z.string().uuid(), revision: z.number().int().nonnegative(),
    lines: z.array(draftLineSchema).max(20),
    preparedRevision: z.number().int().nonnegative().optional(),
  }).optional(),
});
export type BusinessState = z.infer<typeof businessStateSchema>;
export type ConversationDraft = NonNullable<BusinessState["draft"]>;

export function newBusinessState(scope: AgentScope): BusinessState {
  return { version: 2, ...scope, conversationId: randomUUID(), expires: Date.now() + 30 * 60_000, revision: 0 };
}
export function readBusinessState(token: string | undefined, scope: AgentScope, conversationId?: string): BusinessState {
  if (!token) {
    if (conversationId) throw new ApiError(400, "CONVERSATION_CONTEXT_INVALID", "The conversation context is missing. Please start a new task.");
    return newBusinessState(scope);
  }
  const raw = verifyConversationPayload(token);
  if (!raw || raw.userId !== scope.userId || raw.organizationId !== scope.organizationId || raw.branchId !== scope.branchId ||
      typeof raw.expires !== "number" || raw.expires <= Date.now()) {
    throw new ApiError(400, "CONVERSATION_CONTEXT_INVALID", "The conversation context is invalid or expired. Please identify the customer and products again.");
  }
  if (raw.version !== 2) {
    if (conversationId) throw new ApiError(400, "CONVERSATION_CONTEXT_INVALID", "Please start a new conversation.");
    const latest = readConversation(token, scope).at(-1);
    return { ...newBusinessState(scope), ...(latest?.productContext ? { productContext: latest.productContext } : {}),
      ...(latest?.customerAmbiguous ? { customerAmbiguous: true } : {}),
      ...(latest?.productUnresolved ? { productUnresolved: true } : {}),
      ...(latest?.user ? { lastMessage: latest.user.slice(0, 500) } : {}) };
  }
  const parsed = businessStateSchema.safeParse(raw);
  if (!parsed.success || (conversationId && parsed.data.conversationId !== conversationId)) {
    throw new ApiError(400, "CONVERSATION_CONTEXT_INVALID", "The conversation context does not match this task.");
  }
  return parsed.data;
}
export function writeBusinessState(state: BusinessState): string {
  const data = businessStateSchema.parse(state);
  const token = signConversationPayload(data);
  if (token.length > 9000) throw new ApiError(422, "CONVERSATION_STATE_LIMIT", "This task has reached its context limit. Prepare it or start a new conversation.");
  return token;
}
export function touchDraft(state: BusinessState): ConversationDraft {
  state.draft ??= { id: randomUUID(), revision: 0, lines: [] };
  state.draft.revision++;
  delete state.draft.preparedRevision;
  return state.draft;
}
