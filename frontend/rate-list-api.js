import { normalizeWorkspaceContext } from "./workspace-context.js";

export class RateListApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "RateListApiError"; this.status = status; this.code = code; }
}

async function request(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new RateListApiError("Choose an authorized business and branch.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, { credentials: "include", ...options, headers: {
    "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}),
  } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new RateListApiError(body?.error?.message ?? `Rate List request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export const listRateLists = (context) => request("/api/v1/rate-lists", context);
export const getRateList = (context, id) => request(`/api/v1/rate-lists/${encodeURIComponent(id)}`, context);
export const createRateList = (context, input) => request("/api/v1/rate-lists", context, { method: "POST", body: JSON.stringify(input) });
export const createRateListVersion = (context, id, input) => request(`/api/v1/rate-lists/${encodeURIComponent(id)}/versions`, context, { method: "POST", body: JSON.stringify(input) });
export const publishRateListVersion = (context, id, versionId) => request(`/api/v1/rate-lists/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/publish`, context, { method: "POST", body: "{}" });
export const resolveRateListPrice = (context, id, query) => request(`/api/v1/rate-lists/${encodeURIComponent(id)}/price?${new URLSearchParams(query)}`, context);
