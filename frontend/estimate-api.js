import { normalizeWorkspaceContext } from "./workspace-context.js";

export class EstimateApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.code = code;
  }
}

export async function createEstimateDraft(context, input, idempotencyKey) {
  const normalized = normalizeWorkspaceContext(context);
  if (!normalized) throw new EstimateApiError("Choose your business workspace before saving an estimate.", 400, "WORKSPACE_REQUIRED");
  const response = await fetch("/api/v1/estimates", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Organization-Id": normalized.organizationId,
      "X-Branch-Id": normalized.branchId,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new EstimateApiError(
      body?.error?.message ?? `Estimate request failed with HTTP ${response.status}`,
      response.status,
      body?.error?.code ?? "ESTIMATE_REQUEST_FAILED",
    );
  }
  return body;
}
