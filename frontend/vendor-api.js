const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class VendorApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "VendorApiError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeVendorContext(context) {
  const organizationId = String(context?.organizationId ?? "").trim();
  const branchId = String(context?.branchId ?? "").trim();
  if (!UUID_PATTERN.test(organizationId)) throw new Error("Select a valid organization before loading vendors.");
  if (!UUID_PATTERN.test(branchId)) throw new Error("Select a valid branch before loading vendors.");
  return { organizationId, branchId };
}

async function vendorRequest(path, context, options = {}) {
  const normalized = normalizeVendorContext(context);
  const headers = {
    "X-Organization-Id": normalized.organizationId,
    "X-Branch-Id": normalized.branchId,
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { credentials: "include", ...options, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new VendorApiError(
      body?.error?.message ?? `Vendor request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? "VENDOR_REQUEST_FAILED",
    );
  }
  return body;
}

export async function listVendors(context, page = {}) {
  const query = new URLSearchParams({ limit: String(page.limit ?? 50) });
  if (page.cursor !== undefined && page.cursor !== null) query.set("cursor", String(page.cursor));
  return vendorRequest(`/api/v1/vendors?${query}`, context);
}

export async function createVendor(context, input) {
  return vendorRequest("/api/v1/vendors", context, { method: "POST", body: JSON.stringify(input) });
}

export async function updateVendor(context, id, input) {
  return vendorRequest(`/api/v1/vendors/${encodeURIComponent(id)}`, context, { method: "PATCH", body: JSON.stringify(input) });
}
