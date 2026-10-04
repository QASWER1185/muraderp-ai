import { normalizeWorkspaceContext } from "./workspace-context.js";

export class ReturnApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "ReturnApiError"; this.status = status; this.code = code; }
}

async function returnRequest(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new ReturnApiError("Choose your business workspace to use Returns.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: {
      "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ReturnApiError(body?.error?.message ?? `Return request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listReturns(context, { cursor, limit = 50, search } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  if (search) query.set("search", search);
  return returnRequest(`/api/v1/returns?${query}`, context);
}
export function getReturn(context, id) { return returnRequest(`/api/v1/returns/${encodeURIComponent(id)}`, context); }
export function createReturn(context, input, idempotencyKey) {
  return returnRequest("/api/v1/returns", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
