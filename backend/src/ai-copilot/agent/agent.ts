import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors/api-error.js";
import { readConversation, writeConversation, type ProductContext, type ProductReference } from "./conversation.js";
import type { AgentScope, ErpToolRegistry } from "./erp-tools.js";
import type { AgentModel, FunctionCall } from "./model.js";
import type { RankedEntity, EntityResolution } from "../../services/entity-search.service.js";

const MAX_ITERATIONS = 10;
const MAX_CALLS = 12;
const TIMEOUT_MS = 40_000;
const FALLBACK = "I could not verify that request right now. Please clarify or try again.";
const CLARIFY_PRODUCT = "Which product do you mean? Please provide its name or SKU.";
export type AgentLogger = { info: (fields: Record<string, unknown>, message: string) => void; warn: (fields: Record<string, unknown>, message: string) => void };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

function productReference(value: unknown): ProductReference | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || typeof row.name !== "string" || typeof row.sku !== "string" || typeof row.unit !== "string") return null;
  return { id: Number(row.id), name: row.name, sku: row.sku, unit: row.unit };
}

function productResults(tool: string, result: unknown): ProductReference[] | null {
  if (tool === "lookup_product") return result ? [productReference(result)].filter((item): item is ProductReference => item !== null) : [];
  if (tool !== "search_products") return null;
  const resolved = result as EntityResolution<RankedEntity> | null;
  const items = resolved?.resolution === "resolved" ? [resolved.bestCandidate] : resolved?.items;
  return Array.isArray(items) ? items.map(productReference).filter((item): item is ProductReference => item !== null) : [];
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
    const priorProducts = previous.at(-1)?.productContext;
    let customerAmbiguous = previous.at(-1)?.customerAmbiguous === true;
    let productUnresolved = previous.at(-1)?.productUnresolved === true;
    let resolvedCustomerId: number | undefined;
    if (priorProducts) input.push({ role: "assistant", content: `Verified product context:${JSON.stringify(priorProducts)}` });
    input.push({ role: "user", content: request.message });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, TIMEOUT_MS));
    const seen = new Set<string>();
    let calls = 0;
    let verifiedResults = 0;
    let productContext: ProductContext | undefined = priorProducts;
    let productSearches = 0;
    let productLookups = 0;
    let currentCandidates: ProductReference[] = [];
    let uniqueSearchThisTurn = false;
    let requiredToolRetry = false;
    let unresolvedProduct: EntityResolution<RankedEntity> | undefined;
    let unresolvedCustomer: EntityResolution<RankedEntity> | undefined;
    const clarification = (result: EntityResolution<RankedEntity>, kind: string) => {
      const candidates = result.items.map((r) => {
        const row = r as RankedEntity & { city?: string; sku?: string };
        return `${row.name}${row.city ? `, ${row.city}` : ""}${row.sku ? `, SKU ${row.sku}` : ""} (ID ${row.id})`;
      });
      return `Please clarify which ${kind} you mean${candidates.length ? ": " + candidates.join("; ") : " by name, SKU or location"}.`;
    };
    let answer = FALLBACK;
    let status = "limit";
    try {
      for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        if (controller.signal.aborted) { status = "timeout"; break; }
        const step = await withinDeadline(this.model.respond(input, this.tools.definitions(), controller.signal, { toolChoice: requiredToolRetry ? "required" : "auto" }), controller.signal);
        const functions = step.output.filter((item): item is FunctionCall => item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string" && typeof item.arguments === "string");
        if (functions.length === 0) {
          if (unresolvedProduct?.resolution === "no_match" || unresolvedCustomer?.resolution === "no_match") {
            answer = unresolvedProduct?.resolution === "no_match" ? "No matching ERP product is available. Please clarify its name or SKU." : "No matching ERP customer is available. Please clarify the name or location.";
            status = "completed"; break;
          }
          if (unresolvedProduct || unresolvedCustomer || customerAmbiguous) {
            answer = unresolvedProduct ? clarification(unresolvedProduct,"product") : unresolvedCustomer ? clarification(unresolvedCustomer,"customer") : "Please clarify which customer you mean by name or location.";
            status = "clarification"; break;
          }
          if (productUnresolved || productContext?.ambiguous) {
            answer = CLARIFY_PRODUCT;
            status = "clarification"; break;
          }
          if (verifiedResults === 0 && priorProducts?.ambiguous) { answer = CLARIFY_PRODUCT; status = "clarification"; break; }
          if (verifiedResults === 0 && priorProducts?.candidates.length === 1 && !requiredToolRetry) { requiredToolRetry = true; continue; }
          if (step.text && verifiedResults > 0) { answer = step.text.slice(0, 4000); status = "completed"; }
          else status = "empty";
          break;
        }
        requiredToolRetry = false;
        if (functions.length !== step.output.filter((item) => item.type === "function_call").length) { status = "malformed"; break; }
        if (calls + functions.length > MAX_CALLS) { status = "call_limit"; break; }
        input.push(...step.output);
        for (const call of functions) {
          if (controller.signal.aborted) { status = "timeout"; break; }
          let args: unknown;
          try { args = JSON.parse(call.arguments); } catch { status = "malformed"; break; }
          const key = `${call.name}:${JSON.stringify(canonical(args))}`;
          if (seen.has(key)) { status = "duplicate"; break; }
          if (call.name === "lookup_current_sale_rate" && args && typeof args === "object" &&
              ((uniqueSearchThisTurn && "product_id" in args && args.product_id !== productContext?.candidates[0]?.id) ||
               (resolvedCustomerId !== undefined && "customer_id" in args && args.customer_id !== resolvedCustomerId))) {
            answer = "Please clarify the entity selection; the requested ID does not match the resolved ERP candidate.";
            status = "clarification"; break;
          }
          if (call.name === "lookup_current_sale_rate" &&
              (unresolvedProduct || unresolvedCustomer || productUnresolved || customerAmbiguous || (priorProducts?.ambiguous && !uniqueSearchThisTurn))) {
            answer = unresolvedProduct ? clarification(unresolvedProduct,"product") : unresolvedCustomer ? clarification(unresolvedCustomer,"customer") : customerAmbiguous ? "Please clarify which customer you mean by name or location." : CLARIFY_PRODUCT;
            status = "clarification"; break;
          }
          seen.add(key);
          calls++;
          try {
            const result = await withinDeadline(this.tools.execute(call.name, args, scope), controller.signal);
            verifiedResults++;
            if (call.name === "search_products" || call.name === "lookup_customers") {
              const resolution = result as EntityResolution<RankedEntity>;
              const unresolved = resolution.requiresClarification ? resolution : undefined;
              if (call.name === "search_products") { unresolvedProduct = unresolved; productUnresolved = resolution.resolution !== "resolved"; }
              else { unresolvedCustomer = unresolved; customerAmbiguous = resolution.resolution !== "resolved"; resolvedCustomerId = resolution.bestCandidate?.id; }
            }
            const candidates = productResults(call.name, result);
            if (candidates !== null) {
              if (call.name === "search_products") { currentCandidates = []; productSearches++; }
              else if (productSearches === 0 && productLookups === 0 && !priorProducts?.ambiguous) currentCandidates = [];
              if (call.name === "lookup_product") productLookups++;
              for (const item of candidates) if (!currentCandidates.some((candidate) => candidate.id === item.id)) currentCandidates.push(item);
              if (!(priorProducts?.ambiguous && productSearches === 0)) {
                productContext = currentCandidates.length ? { candidates: currentCandidates.slice(0, 5), ambiguous: !!unresolvedProduct || currentCandidates.length > 1 } : undefined;
              }
              uniqueSearchThisTurn = !unresolvedProduct && productSearches > 0 && currentCandidates.length === 1;
            }
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result ?? null) });
            logger?.info({ traceId, iteration, tool: call.name, outcome: "ok" }, "Copilot tool executed");
          } catch (error) {
            if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
            input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: "Tool result unavailable or arguments invalid" }) });
            logger?.warn({ traceId, iteration, tool: call.name, outcome: "error" }, "Copilot tool failed");
          }
        }
        if (status === "malformed" || status === "duplicate" || status === "clarification" || status === "timeout") break;
      }
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
      status = controller.signal.aborted ? "timeout" : "error";
    } finally { clearTimeout(timer); }
    logger?.info({ traceId, status, calls }, "Copilot agent finished");
    return { answer, conversationToken: writeConversation(scope, previous, request.message, answer, productContext, customerAmbiguous, productUnresolved), traceId, status };
  }
}
