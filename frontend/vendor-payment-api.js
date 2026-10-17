import { normalizeWorkspaceContext } from "./workspace-context.js";

export class VendorPaymentApiError extends Error {
  constructor(message, status, code) { super(message); this.name = "VendorPaymentApiError"; this.status = status; this.code = code; }
}

async function paymentRequest(path, context, options = {}) {
  const workspace = normalizeWorkspaceContext(context);
  if (!workspace) throw new VendorPaymentApiError("Choose your business workspace to use Vendor Payments.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch(path, {
    credentials: "include", ...options,
    headers: {
      "X-Organization-Id": workspace.organizationId, "X-Branch-Id": workspace.branchId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new VendorPaymentApiError(body?.error?.message ?? `Vendor Payment request failed with HTTP ${response.status}`, response.status, body?.error?.code);
  return body;
}

export function listVendorPayables(context, { cursor, limit = 100 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return paymentRequest(`/api/v1/browser/vendor-payments/payables?${query}`, context);
}

export function listVendorPayments(context, { cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor != null) query.set("cursor", String(cursor));
  return paymentRequest(`/api/v1/browser/vendor-payments?${query}`, context);
}

export function getVendorPayment(context, id) {
  return paymentRequest(`/api/v1/browser/vendor-payments/${encodeURIComponent(id)}`, context);
}

export function createVendorPayment(context, input, idempotencyKey) {
  return paymentRequest("/api/v1/browser/vendor-payments", context, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}
