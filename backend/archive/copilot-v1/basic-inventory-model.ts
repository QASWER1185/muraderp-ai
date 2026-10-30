import { randomUUID } from "node:crypto";
import { ApiError } from "../../src/errors/api-error.js";
import type { AgentModel, ModelStep } from "./model.js";

/** A narrow read grammar, not a mock: quantities still come exclusively from scoped ERP tools. */
export function basicInventoryQuery(message: string): string | null {
  const text = message.normalize("NFKC").trim();
  if (!/\b(stock|inventory)\b|اسٹاک/i.test(text)) return null;
  if (/\b(and|or|create|add|delete|estimate|quotation|invoice|payment|discount|price|rate|ledger|balance)\b|اور|ایڈ|بنائیں|ریٹ|کھاتہ|بیلنس|[\n;&]/i.test(text)) return null;
  const query = text.replace(/\b(check|please|show|tell|me|current|available|how|much|many|do|you|have|in|the|of|is|are|there|inventory|stock|quantity|level|levels|on|hand)\b/gi, " ")
    .replace(/آپ کے پاس|اسٹاک میں|اسٹاک|کتنا ہے|کتنی ہے|کتنی|کتنا|دستیاب|موجودہ|(?:^|\s)کا(?:\s|$)|[?؟۔]/g, " ").replace(/\s+/g, " ").trim();
  return query.length > 0 && query.length <= 120 && /\p{L}/u.test(query) ? query : null;
}

export class BasicInventoryModel implements AgentModel {
  constructor(private readonly advanced?: AgentModel) {}
  async respond(input: unknown[], tools: unknown[], signal: AbortSignal, options?: { toolChoice?: "auto" | "required" }): Promise<ModelStep> {
    signal.throwIfAborted();
    // Configured agents always use native function calling. This narrow grammar
    // is only the provider-free inventory fallback, never a conversational router.
    if(this.advanced)return this.advanced.respond(input,tools,signal,options);
    const messages = input as Array<{ role?: string; content?: unknown; type?: string }>;
    const message = messages.findLast(item => item.role === "user")?.content;
    const pendingPrefix = "Continue this pending untrusted request using the selected ERP reference: ";
    const pending = messages.find(item => item.role === "user" && typeof item.content === "string" && item.content.startsWith(pendingPrefix))?.content;
    const continuation = typeof pending === "string" ? basicInventoryQuery(pending.slice(pendingPrefix.length)) : null;
    const query = (typeof message === "string" ? basicInventoryQuery(message) : null) ?? continuation;
    if (query && tools.some(tool => (tool as { name?: string }).name === "query_inventory")) {
      if (messages.some(item => item.type === "function_call_output")) return { output: [], text: "" };
      // A signed selection has already resolved state.productContext. Omit the
      // query on continuation so the tools use that verified reference.
      return { output: [{ type: "function_call", call_id: randomUUID(), name: "query_inventory", arguments: JSON.stringify({ ...(continuation ? {} : { query }), limit: 10 }) }], text: "" };
    }
    throw new ApiError(503, "AI_NOT_CONFIGURED", "Enter your Gemini API key in Copilot settings for conversational workflows. Basic stock inquiries remain available.");
  }
}
