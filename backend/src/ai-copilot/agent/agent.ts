import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors/api-error.js";
import { readConversation, writeConversation } from "./conversation.js";
import type { AgentScope, ErpToolRegistry } from "./erp-tools.js";
import type { AgentModel, FunctionCall } from "./model.js";

const MAX_ITERATIONS = 10;
const MAX_CALLS = 12;
const TIMEOUT_MS = 40_000;
const FALLBACK = "I could not verify that request right now. Please clarify or try again.";
export type AgentLogger = { info: (fields: Record<string, unknown>, message: string) => void; warn: (fields: Record<string, unknown>, message: string) => void };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

async function withinDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("agent deadline exceeded");
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("agent deadline exceeded"));
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
  });
}

export class ReadOnlyCopilotAgent {
  constructor(private readonly model: AgentModel, private readonly tools: ErpToolRegistry, private readonly timeoutMs = TIMEOUT_MS) {}
  async run(request: { message: string; conversationToken?: string | undefined }, scope: AgentScope, logger?: AgentLogger) {
    if (!scope.userId || !scope.organizationId || !scope.branchId) throw new ApiError(401, "TENANT_CONTEXT_REQUIRED", "Authenticated user and tenant context are required");
    const traceId = randomUUID();
    const previous = readConversation(request.conversationToken, scope);
    const input: unknown[] = previous.flatMap((turn) => [{ role: "user", content: turn.user }, { role: "assistant", content: turn.assistant }]);
    input.push({ role: "user", content: request.message });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, TIMEOUT_MS));
    const seen = new Set<string>();
    let calls = 0;
    let verifiedResults = 0;
    let answer = FALLBACK;
    let status = "limit";
    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        if (controller.signal.aborted) { status = "timeout"; break; }
        const step = await withinDeadline(this.model.respond(input, this.tools.definitions(), controller.signal), controller.signal);
        const functions = step.output.filter((item): item is FunctionCall => item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && typeof item.arguments === "string");
        if (functions.length === 0) {
          if (step.text && verifiedResults > 0) { answer = step.text.slice(0, 4000); status = "completed"; }
          else status = "empty";
          break;
        }
        if (functions.length !== step.output.filter((item) => item.type === "function_call").length) { status = "malformed"; break; }
        if (calls + functions.length > MAX_CALLS) { status = "call_limit"; break; }
        input.push(...step.output);
        for (const call of functions) {
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { status = "malformed"; break; }
          const key = `${call.name}:${JSON.stringify(canonical(args))}`;
          if (seen.has(key)) { status = "duplicate"; break; }
          seen.add(key);
          calls++;
          try {
            const result = await withinDeadline(this.tools.execute(call.name, args, scope), controller.signal);
            verifiedResults++;
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result ?? null) });
            logger?.info({ traceId, iteration, tool: call.name, outcome: "ok" }, "Copilot tool executed");
          } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: "Tool result unavailable or arguments invalid" }) });
            logger?.warn({ traceId, iteration, tool: call.name, outcome: "error" }, "Copilot tool failed");
          }
        }
        if (status === "malformed" || status === "duplicate") break;
      }
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
      status = controller.signal.aborted ? "timeout" : "error";
    } finally { clearTimeout(timer); }
    logger?.info({ traceId, status, calls }, "Copilot agent finished");
    return { answer, conversationToken: writeConversation(scope, previous, request.message, answer), traceId, status };
  }
}
