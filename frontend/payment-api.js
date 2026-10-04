import { normalizeWorkspaceContext } from "./workspace-context.js";

export class PaymentApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "PaymentApiError"; this.status = status; this.code = code; }
}

async function paymentRequest(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new PaymentApiError("Choose your business workspace to use Customer Payments.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: {
      "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new PaymentApiError(body?.error?.message ?? `Customer Payment request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listReceivables(context, { cursor, limit = 100 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return paymentRequest(`/api/v1/browser/customer-payments/receivables?${query}`, context);
}

export function listCustomerPayments(context, { cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return paymentRequest(`/api/v1/browser/customer-payments?${query}`, context);
}

export function getCustomerPayment(context, id) {
  return paymentRequest(`/api/v1/browser/customer-payments/${encodeURIComponent(id)}`, context);
}

export function createCustomerPayment(context, input, idempotencyKey) {
  return paymentRequest("/api/v1/browser/customer-payments", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
