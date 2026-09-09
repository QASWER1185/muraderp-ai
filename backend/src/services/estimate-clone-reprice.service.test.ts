import { describe, expect, it, vi } from "vitest";
import { DefaultEstimateCloneRepriceService, type EstimateAggregate, type EstimateCloneRepriceRepository, type EstimatePreviewRequest } from "./estimate-clone-reprice.service.js";
import type { CreateEstimateInput } from "../repositories/estimate.repository.js";
import type { PricingService } from "./pricing.service.js";
import type { RateListRecord } from "../repositories/rate-list.repository.js";

const org = "11111111-1111-4111-8111-111111111111";
const branch = "33333333-3333-4333-8333-333333333333";
const context = { actor_user_id: "22222222-2222-4222-8222-222222222222", branch_id: branch, pricing_date: "2026-09-08" };
const preserve: EstimatePreviewRequest = { ...context, source_estimate_id: 50, organization_id: org, mode: "PRESERVE_LINE_BRAND_CONTEXT" };
const source: EstimateAggregate = {
  source_fingerprint: "source-50",
  record: { id: 50, organization_id: org, branch_id: branch, customer_id: 7, estimate_number: "EST-50", issue_date: "2026-08-13", currency_code: "PKR", notes: "source", status: "DRAFT", source_type: "MANUAL", source_reference: null, created_at: "2026-08-13T00:00:00Z", updated_at: "2026-08-13T00:00:00Z" },
  items: [
    { id: 1, estimate_id: 50, line_number: 1, product_id: 10, description: null, quantity: 25, unit: "piece", unit_price: 100, discount_amount: 0, pricing_source: "RESOLVED_RATE", rate_list_id: 11, rate_list_version_id: 111, brand_hint: "Popular", created_at: "", updated_at: "" },
    { id: 2, estimate_id: 50, line_number: 2, product_id: 20, description: null, quantity: 15, unit: "piece", unit_price: 200, discount_amount: 5, pricing_source: "RESOLVED_RATE", rate_list_id: 22, rate_list_version_id: 222, brand_hint: "Dura", created_at: "", updated_at: "" },
    { id: 3, estimate_id: 50, line_number: 3, product_id: 30, description: null, quantity: 10, unit: "meter", unit_price: 300, discount_amount: 0, pricing_source: "RESOLVED_RATE", rate_list_id: 33, rate_list_version_id: 333, brand_hint: "GM Cable", created_at: "", updated_at: "" },
  ],
};

function resolved(productId: number, listId: number, price: number) {
  return { rate_list_id: listId, rate_list_version_id: listId + 100, rate_list_item_id: listId + 200, product_id: productId, unit_price: price, unit: productId === 30 ? "meter" : "piece", currency_code: "PKR", minimum_quantity: 1, scope_type: "GLOBAL" as const, effective_from: "2026-01-01T00:00:00Z" };
}

function setup(prices: Record<string, number | null>, errors: Record<string, string> = {}) {
  const aggregate = structuredClone(source);
  const saved = new Map<string, { request: unknown; result: EstimateAggregate }>();
  const atomic = vi.fn(async (input: CreateEstimateInput) => {
    const result: EstimateAggregate = { source_fingerprint: "created", record: { ...source.record, ...input.definition, id: 99 + saved.size }, items: input.lines.map((line, index) => ({
      ...source.items[index]!, ...line, id: 100 + index, estimate_id: 99, description: line.description ?? null, discount_amount: line.discount_amount ?? 0,
      rate_list_id: line.rate_list_id ?? null, rate_list_version_id: line.rate_list_version_id ?? null, rate_list_selection_source: "LINE_OVERRIDE",
    })) };
    saved.set(input.idempotency_key!, { request: input.conversion_request, result });
    return result;
  });
  const repository: EstimateCloneRepriceRepository = { getEstimateAggregate: vi.fn(async () => aggregate), createEstimateAtomic: atomic, getConversionReplay: vi.fn(async (_org, _actor, key) => saved.get(key) ?? null) };
  const pricing: PricingService = { resolveCandidate: vi.fn(), resolvePrice: vi.fn(async ({ product_id, rate_list_id }) => { const key = `${product_id}:${rate_list_id}`; if (errors[key]) throw new Error(errors[key]); const price = prices[key]; return price == null ? null : resolved(product_id, rate_list_id!, price); }) };
  const lists: RateListRecord[] = [11, 22, 33, 99].map((id) => ({ id, organization_id: org, name: `List ${id}`, code: `L${id}`, price_type: "SALE", scope_type: "GLOBAL", currency_code: "PKR", is_active: true, created_at: "", updated_at: "" }));
  const authorization = { assertAuthorized: vi.fn(async () => {}) };
  const service = new DefaultEstimateCloneRepriceService(repository, pricing, authorization, { listActiveSaleRateLists: async () => lists });
  const confirm = async (request = preserve, key = "clone-1") => {
    const preview = await service.preview(request);
    return { ...request, target_estimate_number: "EST-NEW", idempotency_key: key, preview_fingerprint: preview.preview_fingerprint };
  };
  return { service, repository, atomic, aggregate, pricing, authorization, confirm, saved, lists };
}

describe("EstimateCloneRepriceService", () => {
  it("previews mixed-brand lines independently and resolves before confirmation", async () => {
    const { service } = setup({ "10:11": 110, "20:22": 220, "30:33": 330 });
    const preview = await service.preview(preserve);
    expect(preview.can_create).toBe(true);
    expect(preview.lines.map((line) => [line.target_rate_list_id, line.target_price, line.status])).toEqual([[11, 110, "RESOLVED"], [22, 220, "RESOLVED"], [33, 330, "RESOLVED"]]);
  });

  it("reprices every line to an explicit target and blocks missing target prices", async () => {
    const { service, atomic } = setup({ "10:99": 150, "20:99": null, "30:99": 350 });
    const request = { ...preserve, mode: "REPRICE_ALL_TO_TARGET_RATE_LIST" as const, target_rate_list_id: 99 };
    const preview = await service.preview(request);
    expect(preview.lines.map((line) => line.target_rate_list_id)).toEqual([99, 99, 99]);
    expect(preview.lines[1]).toMatchObject({ status: "MISSING_RATE", product_id: 20 });
    await expect(service.execute({ ...request, preview_fingerprint: preview.preview_fingerprint, idempotency_key: "missing", target_estimate_number: "EST-99" })).rejects.toThrow("line 2 MISSING_RATE");
    expect(atomic).not.toHaveBeenCalled();
  });

  it("fails closed for ambiguous pricing and unresolved line context", async () => {
    const { service, aggregate } = setup({ "10:11": 110 }, { "20:22": "Ambiguous pricing: multiple active rate lists match" });
    aggregate.items[2]!.rate_list_id = null;
    const preview = await service.preview(preserve);
    expect(preview.lines[1]?.status).toBe("AMBIGUOUS");
    expect(preview.lines[2]?.status).toBe("UNRESOLVED_BRAND");
    expect(preview.can_create).toBe(false);
  });

  it("creates a new estimate with stable structure while preserving the source", async () => {
    const { service, atomic, aggregate, confirm } = setup({ "10:11": 110, "20:22": 220, "30:33": 330 });
    aggregate.items.reverse();
    const before = JSON.stringify(aggregate);
    const result = await service.execute(await confirm());
    expect(result.id).toBe(99);
    expect(result.lines.map((line) => line.product_id)).toEqual([10, 20, 30]);
    expect(result.lines.map((line) => line.quantity)).toEqual([25, 15, 10]);
    expect(result.lines.map((line) => line.unit)).toEqual(["piece", "piece", "meter"]);
    expect(atomic).toHaveBeenCalledOnce();
    expect(result.definition.customer_id).toBe(7);
    expect(result.lines.map((line) => line.line_number)).toEqual([1, 2, 3]);
    expect(result.lines[1]?.discount_amount).toBe(5);
    expect(JSON.stringify(aggregate)).toBe(before);
  });

  it("does not call persistence when target list is omitted", async () => {
    const { service, atomic } = setup({});
    const preview = await service.preview({ ...preserve, mode: "REPRICE_ALL_TO_TARGET_RATE_LIST" });
    expect(preview.can_create).toBe(false);
    expect(preview.lines.every((line) => line.status === "INVALID_TARGET")).toBe(true);
    expect(atomic).not.toHaveBeenCalled();
  });

  it("forwards the idempotency key so a retry returns the same created estimate", async () => {
    const { service, atomic, confirm, pricing } = setup({ "10:11": 110, "20:22": 220, "30:33": 330 });
    const request = await confirm(preserve, "retry-key");
    const first = await service.execute(request);
    vi.mocked(pricing.resolvePrice).mockRejectedValue(new Error("rates subsequently unavailable"));
    const second = await service.execute(request);
    expect(first.id).toBe(99);
    expect(second.id).toBe(99);
    expect(second).toEqual(first);
    expect(atomic).toHaveBeenCalledTimes(1);
    expect(atomic).toHaveBeenLastCalledWith(expect.objectContaining({ idempotency_key: "retry-key" }));
  });

  it("requires a new preview if rates or the source change after approval", async () => {
    const prices = { "10:11": 110, "20:22": 220, "30:33": 330 };
    const { service, confirm, atomic, aggregate } = setup(prices);
    const request = await confirm();
    prices["10:11"] = 120;
    await expect(service.execute(request)).rejects.toThrow("Source or prices changed");
    prices["10:11"] = 110;
    aggregate.source_fingerprint = "changed";
    await expect(service.execute(request)).rejects.toThrow("Source or prices changed");
    expect(atomic).not.toHaveBeenCalled();
  });

  it("rejects idempotency key reuse for a different conversion", async () => {
    const { service, confirm } = setup({ "10:11": 110, "20:22": 220, "30:33": 330 });
    const request = await confirm();
    await service.execute(request);
    await expect(service.execute({ ...request, target_estimate_number: "changed" })).rejects.toThrow("reused for a different");
  });

  it("checks actor permissions before source reads and on retries", async () => {
    const { service, authorization, repository } = setup({});
    authorization.assertAuthorized.mockRejectedValue(new Error("branch denied"));
    await expect(service.preview(preserve)).rejects.toThrow("branch denied");
    expect(repository.getEstimateAggregate).not.toHaveBeenCalled();
  });

  it.each(["organization", "branch", "legacy branch"])("rejects incorrect source %s ownership", async (kind) => {
    const { service, aggregate } = setup({});
    if (kind === "organization") aggregate.record.organization_id = "foreign";
    if (kind === "branch") aggregate.record.branch_id = "foreign";
    if (kind === "legacy branch") aggregate.record.branch_id = null;
    await expect(service.preview(preserve)).rejects.toThrow();
  });

  it("uses one explicit target, clears stale brands, and supports reverse conversion", async () => {
    const { service, confirm, aggregate, saved } = setup({ "10:99": 150, "20:99": 250, "30:99": 350, "10:11": 100, "20:11": 200, "30:11": 300 });
    const converted = await service.execute(await confirm({ ...preserve, mode: "REPRICE_ALL_TO_TARGET_RATE_LIST", target_rate_list_id: 99 }));
    expect(converted.lines.map((line) => [line.rate_list_id, line.brand_hint])).toEqual([[99, null], [99, null], [99, null]]);
    Object.assign(aggregate, structuredClone(saved.get("clone-1")!.result));
    const reversed = await service.execute(await confirm({ ...preserve, source_estimate_id: 99, mode: "REPRICE_ALL_TO_TARGET_RATE_LIST", target_rate_list_id: 11 }, "reverse"));
    expect(reversed.lines.map((line) => line.unit_price)).toEqual([100, 200, 300]);
  });

  it.each(["unit", "currency", "discount"])("blocks incompatible target %s", async (kind) => {
    const { service, pricing, aggregate } = setup({});
    if (kind === "discount") aggregate.items[0]!.discount_amount = 999999;
    vi.mocked(pricing.resolvePrice).mockResolvedValue({ ...resolved(10, 11, 100), ...(kind === "unit" ? { unit: "box" } : {}), ...(kind === "currency" ? { currency_code: "USD" } : {}) });
    expect((await service.preview(preserve)).lines[0]?.status).toBe("INVALID_TARGET");
  });

  it("does not disguise infrastructure failure as missing business data", async () => {
    const { service } = setup({}, { "10:11": "database connection failed" });
    await expect(service.preview(preserve)).rejects.toThrow("database connection failed");
  });
});
