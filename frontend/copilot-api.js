function newIdempotencyKey(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Copilot request failed");
  return body;
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
