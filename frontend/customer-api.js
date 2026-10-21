const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CustomerApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "CustomerApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeCustomerContext(context) {
  const organizationId = String(context?.organizationId ?? "").trim();
  const branchId = String(context?.branchId ?? "").trim();
  if (!UUID_PATTERN.test(organizationId)) throw new Error("Select a valid organization before loading customers.");
  if (!UUID_PATTERN.test(branchId)) throw new Error("Select a valid branch before loading customers.");
  return { organizationId, branchId };
}

async function customerRequest(path, context, options = {}) {
  const normalized = normalizeCustomerContext(context);
  const headers = {
    "X-Organization-Id": normalized.organizationId,
    "X-Branch-Id": normalized.branchId,
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { credentials: "include", ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CustomerApiError(
      body?.error?.message ?? `Customer request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? "CUSTOMER_REQUEST_FAILED",
    );
  }
  return body;
}

export async function listCustomers(context, page = {}) {
  const query = new URLSearchParams({ limit: String(page.limit ?? 50) });
  if (page.cursor !== undefined && page.cursor !== null) query.set("cursor", String(page.cursor));
  return customerRequest(`/api/v1/customers?${query}`, context);
}

export async function createCustomer(context, input) {
  return customerRequest("/api/v1/customers", context, { method: "POST", body: JSON.stringify(input) });
}

export async function updateCustomer(context, id, input) {
  return customerRequest(`/api/v1/customers/${encodeURIComponent(id)}`, context, { method: "PATCH", body: JSON.stringify(input) });
}
