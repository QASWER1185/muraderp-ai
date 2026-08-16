function newIdempotencyKey(prefix) { return `${prefix}-${crypto.randomUUID()}`; }

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "include", ...options, headers: { "Content-Type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? "Copilot request failed");
  return body;
}

export async function createCopilotDraft(input) {
  return api("/api/v1/ai/copilot/drafts", {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey("copilot-draft") },
    body: JSON.stringify(input),
  });
}

export async function confirmCopilotDraft({ id, organizationId, userId, idempotencyKey }) {
  return api(`/api/v1/ai/copilot/drafts/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
    headers: { "X-Organization-Id": organizationId, ...(userId ? { "X-User-Id": userId } : {}), "Idempotency-Key": idempotencyKey },
  });
}
