import { normalizeWorkspaceContext } from "./workspace-context.js";

export class StockApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "StockApiError"; this.status = status; this.code = code; }
}

async function stockRequest(path, context) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new StockApiError("Choose your business workspace to view stock.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include",
    headers: { "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new StockApiError(body?.error?.message ?? `Stock request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

function queryFor({ cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return query;
}

export function listStockBalances(context, options) {
  return stockRequest(`/api/v1/browser/stock/balances?${queryFor(options)}`, context);
}

export function listStockMovements(context, options) {
  return stockRequest(`/api/v1/browser/stock/movements?${queryFor(options)}`, context);
}
