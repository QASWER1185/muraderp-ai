import { normalizeWorkspaceContext } from "./workspace-context.js";

export class ProductApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ProductApiError";
    this.status = status;
    this.code = code;
  }
}

function productRequest(path, context, options = {}) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new Error("Choose a valid business workspace before loading products.");
  const headers = {
    "X-Organization-Id": normalized.organizationId,
    "X-Branch-Id": normalized.branchId,
    ...(options.headers ?? {}),
  };
  return fetch(path, { credentials: "include", ...options, headers }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ProductApiError(body?.error?.message ?? `Product request failed with HTTP ${response.status}`, response.status, body?.error?.code ?? "PRODUCT_REQUEST_FAILED");
    return body;
  });
}

export function listProducts(context, { search = "", cursor, limit = 50 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  const term = String(search).trim();
  if (term) query.set("search", term);
  if (cursor !== undefined && cursor !== null) query.set("cursor", String(cursor));
  return productRequest(`/api/v1/products?${query}`, context);
}

export function getProduct(context, id) {
  return productRequest(`/api/v1/products/${encodeURIComponent(id)}`, context);
}

export function createProduct(context, product) {
  return productRequest("/api/v1/products", context, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
}

export function updateProduct(context, id, product) {
  return productRequest(`/api/v1/products/${encodeURIComponent(id)}`, context, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
}

