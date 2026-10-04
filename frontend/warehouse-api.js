import { normalizeWorkspaceContext } from "./workspace-context.js";

export class WarehouseApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "WarehouseApiError"; this.status = status; this.code = code; }
}

async function requestWarehouse(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new WarehouseApiError("Choose your business workspace to use Warehouses.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: { "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new WarehouseApiError(body?.error?.message ?? `Warehouse request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listWarehouses(context, page = {}) {
  const query = new URLSearchParams({ limit: String(page.limit ?? 50) });
  if (page.cursor != null) query.set("cursor", String(page.cursor));
  return requestWarehouse(`/api/v1/warehouses?${query}`, context);
}
export function getWarehouse(context, id) { return requestWarehouse(`/api/v1/warehouses/${encodeURIComponent(id)}`, context); }
export function createWarehouse(context, input) { return requestWarehouse("/api/v1/warehouses", context, { method: "POST", body: JSON.stringify(input) }); }
export function updateWarehouse(context, id, input) { return requestWarehouse(`/api/v1/warehouses/${encodeURIComponent(id)}`, context, { method: "PATCH", body: JSON.stringify(input) }); }
