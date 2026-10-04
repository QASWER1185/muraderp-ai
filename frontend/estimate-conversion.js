async function estimateBusinessRequest(path, context, options = {}) {
  if (!context?.organizationId || !context?.branchId) throw new Error("Choose your business workspace before changing rates.");
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      "X-Organization-Id": context.organizationId,
      "X-Branch-Id": context.branchId,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `Estimate request failed with HTTP ${response.status}`);
  return body.data;
}

export function listEstimateRateLists(context, { customerId = null, currencyCode = "PKR" } = {}) {
  const query = new URLSearchParams({ currency_code: currencyCode });
  if (customerId != null) query.set("customer_id", String(customerId));
  return estimateBusinessRequest(`/api/v1/estimates/rate-lists?${query}`, context);
}

export function previewEstimateRateList(context, payload) {
  return estimateBusinessRequest("/api/v1/estimates/rate-list-preview", context, { method: "POST", body: JSON.stringify(payload) });
}

export async function prepareEstimateWhatsAppShare(context) {
  const delivery = await estimateBusinessRequest(`/api/v1/estimates/${encodeURIComponent(context.estimateId)}/whatsapp-share`, context, { method: "GET" });
  const shareUrl = new URL(delivery?.share_url);
  if (shareUrl.protocol !== "https:" || shareUrl.hostname !== "wa.me") throw new Error("WhatsApp share returned an invalid destination");
  return delivery;
}

async function postConversion(context, action, payload, key) {
  const response = await fetch(`/api/v1/estimates/${encodeURIComponent(context.sourceId)}/reprice/${action}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Organization-Id": context.organizationId,
      "X-Branch-Id": context.branchId,
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? "Estimate conversion failed");
  return body.data;
}

// Retained for existing saved-estimate conversion callers. The Estimate editor
// now uses the business-facing draft preview API above and never asks for IDs.
export function createConversionSession() {
  let reviewed = null;
  return {
    clear() { reviewed = null; },
    async preview(context, payload) {
      reviewed = null;
      const result = await postConversion(context, "preview", payload);
      if (result.can_create) reviewed = { context: { ...context }, payload: { ...payload }, fingerprint: result.preview_fingerprint, key: `estimate-clone-${crypto.randomUUID()}`, number: null };
      return result;
    },
    async confirm(number) {
      if (!reviewed) throw new Error("Review a fully resolved preview before confirming.");
      if (reviewed.number && reviewed.number !== number) throw new Error("The estimate number changed. Review a new preview before confirming.");
      reviewed.number = number;
      const result = await postConversion(reviewed.context, "confirm", { ...reviewed.payload, target_estimate_number: number, preview_fingerprint: reviewed.fingerprint }, reviewed.key);
      reviewed = null;
      return result;
    },
  };
}
