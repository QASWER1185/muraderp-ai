import { getCopilotApiKey } from "./copilot-key.js";
import { boundedFetch } from "./request.js";

function newIdempotencyKey(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

async function api(path, options = {}) {
  const apiKey = getCopilotApiKey();
  const response = await boundedFetch(path, { credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(apiKey ? { "X-Api-Key": apiKey, "X-AI-Provider": "gemini" } : {}), ...(options.headers ?? {}) } }, path.endsWith("/settings") ? 15000 : path.endsWith("/agent/input") || path==="/api/copilot/chat" ? 300000 : 65000);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message ?? "Copilot request failed");
    error.code = body.error?.code;
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function getCopilotProviderStatus() {
  return api("/api/v1/ai/copilot/settings", { method: "GET" });
}

export async function testCopilotProvider() {
  return api("/api/v1/ai/copilot/settings/test", { method: "POST", body: "{}" });
}

export async function createCopilotDraft(input, branchId, idempotencyKey = newIdempotencyKey("copilot-draft")) {
  return api("/api/v1/ai/copilot/drafts", {
    method: "POST",
    headers: { "X-Branch-Id": branchId, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function createCopilotReview(input, branchId) {
  return api("/api/v1/ai/copilot/review", {
    method: "POST",
    headers: { "X-Branch-Id": branchId },
    body: JSON.stringify(input),
  });
}

export async function askCopilot(message, organizationId, branchId, conversationToken, conversationId, selection) {
  return api("/api/v1/ai/copilot/agent", {
    method: "POST",
    headers: { "X-Organization-Id": organizationId, "X-Branch-Id": branchId },
    body: JSON.stringify({ message, ...(conversationToken ? { conversationToken } : {}), ...(conversationId ? { conversationId } : {}),...(selection?{selection}:{}) }),
  });
}

export async function askCopilotMedia(input, organizationId, branchId) {
  return api(input.attachments ? "/api/copilot/chat" : "/api/v1/ai/copilot/agent/input", {
    method:"POST",headers:{"X-Organization-Id":organizationId,"X-Branch-Id":branchId},body:JSON.stringify(input),
  });
}

export async function prepareConversationDraft(conversationToken, conversationId, organizationId, branchId) {
  return api("/api/v1/ai/copilot/conversation/drafts", {
    method: "POST", headers: { "X-Organization-Id": organizationId, "X-Branch-Id": branchId },
    body: JSON.stringify({ conversationToken, conversationId }),
  });
}

export async function prepareConversationPayment(conversationToken, conversationId, organizationId, branchId) {
  return api("/api/v1/ai/copilot/conversation/payments", {
    method: "POST", headers: { "X-Organization-Id": organizationId, "X-Branch-Id": branchId },
    body: JSON.stringify({ conversationToken, conversationId }),
  });
}

export async function quoteCopilotEstimateLine(input, branchId) {
  return api("/api/v1/ai/copilot/review/quote", {
    method: "POST", headers: { "X-Branch-Id": branchId }, body: JSON.stringify(input),
  });
}

export async function extractInvoiceDocument(input, branchId) {
  return api("/api/v1/ai/copilot/extract/invoice", {
    method: "POST",
    headers: { "X-Branch-Id": branchId },
    body: JSON.stringify(input),
  });
}

export async function createCopilotMasterDataDraft(input, branchId, idempotencyKey = newIdempotencyKey("copilot-master-data")) {
  return api("/api/v1/ai/copilot/master-data/drafts", {
    method: "POST",
    headers: { "X-Branch-Id": branchId, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function createCopilotRateListDraft(input, branchId, idempotencyKey = newIdempotencyKey("copilot-rate-list")) {
  return api("/api/v1/ai/copilot/rate-list/drafts", {
    method: "POST",
    headers: { "X-Branch-Id": branchId, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function createCopilotFinancialDraft(input, branchId, idempotencyKey = newIdempotencyKey("copilot-financial")) {
  return api("/api/v1/ai/copilot/financial/drafts", {
    method: "POST",
    headers: { "X-Branch-Id": branchId, "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(input),
  });
}

export async function confirmCopilotDraft({ id, organizationId, branchId, userId, idempotencyKey }) {
  return api(`/api/v1/ai/copilot/drafts/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    headers: { "X-Organization-Id": organizationId, "X-Branch-Id": branchId, ...(userId ? { "X-User-Id": userId } : {}), "Idempotency-Key": idempotencyKey },
  });
}
