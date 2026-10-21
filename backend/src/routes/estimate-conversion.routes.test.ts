import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { ApiError } from "../errors/api-error.js";
import type { EstimateCloneRepriceService } from "../services/estimate-clone-reprice.service.js";

const token = "estimate-conversion-internal-test-token-0123456789";
const headers = { Authorization: `Bearer ${token}`, "X-Organization-Id": "11111111-1111-4111-8111-111111111111", "X-Branch-Id": "33333333-3333-4333-8333-333333333333", "X-Actor-User-Id": "22222222-2222-4222-8222-222222222222" };
const input = { mode: "REPRICE_ALL_TO_TARGET_RATE_LIST", target_rate_list_id: 22, pricing_date: "2026-09-09" };

function setup() {
  const preview = vi.fn<EstimateCloneRepriceService["preview"]>().mockResolvedValue({ source_estimate_id: 50, organization_id: headers["X-Organization-Id"], mode: "REPRICE_ALL_TO_TARGET_RATE_LIST", target_rate_list_id: 22, pricing_date: input.pricing_date, preview_fingerprint: "a".repeat(64), lines: [], can_create: false });
  const execute = vi.fn<EstimateCloneRepriceService["execute"]>();
  const app = createApp({ internalApiToken: token, internalApiPrincipalId: "estimate-conversion-test", estimateConversionService: { preview, execute } });
  return { app, preview, execute };
}

describe("Estimate conversion routes", () => {
  it("exposes the preview under the versioned estimates route with authenticated context", async () => {
    const { app, preview, execute } = setup();
    const response = await request(app).post("/api/v1/estimates/50/reprice/preview").set(headers).send(input);
    expect(response.status).toBe(200);
    expect(response.body.data.preview_fingerprint).toHaveLength(64);
    expect(preview).toHaveBeenCalledWith({ source_estimate_id: 50, organization_id: headers["X-Organization-Id"], branch_id: headers["X-Branch-Id"], actor_user_id: headers["X-Actor-User-Id"], ...input });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(["no credentials", "forged cookie", "missing context"])("rejects %s before calling the service", async (kind) => {
    const { app, preview } = setup();
    let call = request(app).post("/api/v1/estimates/50/reprice/preview");
    if (kind === "forged cookie") call = call.set("Cookie", "muraderp_session=forged.signature");
    if (kind === "missing context") call = call.set("Authorization", headers.Authorization);
    const response = await call.send(input);
    expect(response.status).toBe(kind === "missing context" ? 400 : 401);
    expect(preview).not.toHaveBeenCalled();
  });

  it.each(["key", "fingerprint"])("requires the confirmation %s", async (missing) => {
    const { app, execute } = setup();
    let call = request(app).post("/api/v1/estimates/50/reprice/confirm").set(headers);
    if (missing !== "key") call = call.set("Idempotency-Key", "clone-1");
    const response = await call.send({ ...input, target_estimate_number: "EST-NEW", ...(missing !== "fingerprint" ? { preview_fingerprint: "a".repeat(64) } : {}) });
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("passes confirmation and idempotency through the service and returns the new reference", async () => {
    const { app, execute } = setup();
    execute.mockResolvedValue({ id: 99, status: "DRAFT", definition: { organization_id: headers["X-Organization-Id"], customer_id: 7, estimate_number: "EST-NEW", issue_date: "2026-09-09", currency_code: "PKR" }, lines: [], totals: { subtotal: 0, discount_total: 0, grand_total: 0, pass_through_rent: 0, customer_payable_total: 0 } });
    const response = await request(app).post("/api/v1/estimates/50/reprice/confirm").set(headers).set("Idempotency-Key", "clone-1").send({ ...input, target_estimate_number: "EST-NEW", preview_fingerprint: "a".repeat(64) });
    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(99);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ idempotency_key: "clone-1", preview_fingerprint: "a".repeat(64) }));
  });

  it.each([[403, "BRANCH_ACCESS_DENIED"], [409, "PREVIEW_CHANGED"], [422, "CONVERSION_BLOCKED"]] as const)("returns domain status %s and exact line failures", async (status, code) => {
    const { app, execute } = setup();
    execute.mockRejectedValue(new ApiError(status, code, "Review the preview", [{ line_number: 2, status: "MISSING_RATE" }]));
    const response = await request(app).post("/api/v1/estimates/50/reprice/confirm").set(headers).set("Idempotency-Key", "clone-1").send({ ...input, target_estimate_number: "EST-NEW", preview_fingerprint: "a".repeat(64) });
    expect(response.status).toBe(status);
    expect(response.body.error.details[0].line_number).toBe(2);
  });
});
