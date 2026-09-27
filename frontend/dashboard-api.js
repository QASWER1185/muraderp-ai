import { normalizeWorkspaceContext } from "./workspace-context.js";

export class DashboardApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.code = code;
  }
}

async function dashboardRequest(path, context) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new DashboardApiError("Choose your business workspace to load live dashboard data.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "X-Organization-Id": normalized.organizationId,
      "X-Branch-Id": normalized.branchId,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new DashboardApiError(
      body?.error?.message ?? `Dashboard request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? "DASHBOARD_REQUEST_FAILED",
    );
  }
  return body;
}

export function getDashboardStock(context) {
  return dashboardRequest("/api/v1/dashboard/stock", context);
}
