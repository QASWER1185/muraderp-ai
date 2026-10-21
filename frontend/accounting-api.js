import { normalizeWorkspaceContext } from "./workspace-context.js";

export class AccountingApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "AccountingApiError"; this.status = status; this.code = code; }
}

async function read(path, context) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new AccountingApiError("Choose a business workspace to view accounting.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include",
    headers: { "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountingApiError(body?.error?.message ?? `Accounting request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

function pageQuery({ limit = 50, offset = 0 } = {}) {
  return new URLSearchParams({ limit: String(limit), offset: String(offset) });
}

export const listAccounts = (context) => read("/api/v1/browser/accounting/accounts", context);
export const listJournalEntries = (context, options) => read(`/api/v1/browser/accounting/entries?${pageQuery(options)}`, context);
export const getJournalEntry = (context, id) => read(`/api/v1/browser/accounting/entries/${encodeURIComponent(id)}`, context);
export const listAccountLedger = (context, id, options) => read(`/api/v1/browser/accounting/accounts/${encodeURIComponent(id)}/ledger?${pageQuery(options)}`, context);
