import { normalizeWorkspaceContext } from "./workspace-context.js";

export class InvoiceApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "InvoiceApiError"; this.status = status; this.code = code; }
}

async function invoiceRequest(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new InvoiceApiError("Choose your business workspace to use Invoices.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: {
      "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new InvoiceApiError(body?.error?.message ?? `Invoice request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listInvoices(context, { cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return invoiceRequest(`/api/v1/invoices?${query}`, context);
}
export function getInvoice(context, id) { return invoiceRequest(`/api/v1/invoices/${encodeURIComponent(id)}`, context); }
export function listReadyEstimates(context) { return invoiceRequest("/api/v1/invoices/ready-estimates", context); }
export function getReadyEstimate(context, id) { return invoiceRequest(`/api/v1/invoices/ready-estimates/${encodeURIComponent(id)}`, context); }
export function createInvoice(context, input, idempotencyKey) {
  return invoiceRequest("/api/v1/invoices", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
export function createInvoiceFromEstimate(context, input, idempotencyKey) {
  return invoiceRequest("/api/v1/invoices/from-estimate", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
