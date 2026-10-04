import { normalizeWorkspaceContext } from "./workspace-context.js";

export class PurchaseApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "PurchaseApiError"; this.status = status; this.code = code; }
}

async function purchaseRequest(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new PurchaseApiError("Choose your business workspace to use Purchases.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: {
      "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PurchaseApiError(body?.error?.message ?? `Purchase request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listPurchases(context, { cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return purchaseRequest(`/api/v1/browser/purchases?${query}`, context);
}
export function getPurchase(context, id) { return purchaseRequest(`/api/v1/browser/purchases/${encodeURIComponent(id)}`, context); }
export function createPurchase(context, input, idempotencyKey) {
  return purchaseRequest("/api/v1/browser/purchases", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
