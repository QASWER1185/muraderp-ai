import { normalizeWorkspaceContext } from "./workspace-context.js";

export class ReportsApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "ReportsApiError"; this.status = status; this.code = code; }
}

async function read(path, context) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new ReportsApiError("Choose a business workspace to view reports.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include",
    headers: { "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ReportsApiError(body?.error?.message ?? `Report request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

const periodQuery = (period) => new URLSearchParams({ from: period.from, to: period.to });
export const getReportOverview = (context) => read("/api/v1/browser/reports/overview", context);
export const getFinancialSummary = (context, period) => read(`/api/v1/browser/reports/summary?${periodQuery(period)}`, context);
export const getTrialBalance = (context, period) => read(`/api/v1/browser/reports/trial-balance?${periodQuery(period)}`, context);
export const getReportHead = (context, head, period) => read(`/api/v1/browser/reports/details?${new URLSearchParams({ head, ...period })}`, context);
