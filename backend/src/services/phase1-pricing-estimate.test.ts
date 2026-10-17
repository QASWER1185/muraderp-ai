import { describe, expect, it, vi } from "vitest";
import { DefaultEstimatePricingService } from "./estimate-pricing.service.js";
import { DefaultEstimateService } from "./estimate.service.js";
import type { EstimateRepository, EstimateRecord } from "../repositories/estimate.repository.js";
import type { PricingService } from "./pricing.service.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";
import type { ResolvedPrice } from "../types/pricing.types.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "33333333-3333-4333-8333-333333333333";
const context = {
  organization_id: organizationId,
  price_type: "SALE" as const,
  as_of: "2026-08-13",
  customer_id: 7,
};

const resolved = (productId: number, listId: number, price: number): ResolvedPrice => ({
  rate_list_id: listId,
  rate_list_version_id: listId + 100,
  rate_list_item_id: listId + 200,
  product_id: productId,
  unit_price: price,
  unit: "piece",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "GLOBAL",
  effective_from: "2026-01-01T00:00:00Z",
});

describe("Phase 1 pricing and estimate safety", () => {
  it("keeps resolved pricing provenance when a priced line is validated again", async () => {
    const resolvePrice = vi.fn(async () => resolved(10, 11, 105));
    const pricing = new DefaultEstimatePricingService({ resolvePrice, resolveCandidate: vi.fn() });
    const result = await pricing.priceLine({ line_number: 1, product_id: 10, quantity: 2, unit: "piece", unit_price: 100, pricing_source: "RESOLVED_RATE", rate_list_id: 11 }, context);
    expect(resolvePrice).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ unit_price: 105, pricing_source: "RESOLVED_RATE", rate_list_selection_source: "LINE_OVERRIDE", rate_list_version_id: 111 });
  });
  it("rejects an unresolved brand hint before any implicit/default price lookup", async () => {
    const resolvePrice = vi.fn<PricingService["resolvePrice"]>();
    const pricing = new DefaultEstimatePricingService({
      resolvePrice,
      resolveCandidate: vi.fn(),
    });

    await expect(pricing.priceLine({
      line_number: 1,
      product_id: 10,
      quantity: 1,
      unit: "piece",
      brand_hint: "Popular",
    }, { ...context, rate_list_id: 99 })).rejects.toThrow("brand_hint requires an explicit line-level rate_list_id");
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it("keeps independent line-level rate lists for a mixed-brand estimate", async () => {
    const resolvePrice = vi.fn(async (input: Parameters<PricingService["resolvePrice"]>[0]) =>
      resolved(input.product_id, input.rate_list_id ?? 0, input.product_id === 10 ? 100 : 200));
    const pricing = new DefaultEstimatePricingService({
      resolvePrice,
      resolveCandidate: vi.fn(),
    });
    const first = await pricing.priceLine({ line_number: 1, product_id: 10, quantity: 1, unit: "piece", rate_list_id: 11, rate_list_selection_source: "LINE_OVERRIDE", brand_hint: "Popular" }, context);
    const second = await pricing.priceLine({ line_number: 2, product_id: 20, quantity: 1, unit: "piece", rate_list_id: 22, rate_list_selection_source: "LINE_OVERRIDE", brand_hint: "Dura" }, context);

    expect(resolvePrice).toHaveBeenNthCalledWith(1, expect.objectContaining({ product_id: 10, rate_list_id: 11 }));
    expect(resolvePrice).toHaveBeenNthCalledWith(2, expect.objectContaining({ product_id: 20, rate_list_id: 22 }));
    expect(first).toMatchObject({ rate_list_id: 11, brand_hint: "Popular" });
    expect(second).toMatchObject({ rate_list_id: 22, brand_hint: "Dura" });
  });

  it("uses the atomic repository operation and never starts the legacy header/line sequence", async () => {
    const record: EstimateRecord = {
      id: 900,
      organization_id: organizationId,
      branch_id: branchId,
      customer_id: 7,
      estimate_number: "EST-ATOMIC-1",
      issue_date: "2026-08-13",
      currency_code: "PKR",
      notes: null,
      status: "DRAFT",
      source_type: "AI_ASSISTED",
      source_reference: "ai-copilot:key",
      created_at: "2026-08-13T10:00:00Z",
      updated_at: "2026-08-13T10:00:00Z",
    };
    const line: PricedEstimateLine = {
      line_number: 1,
      product_id: 10,
      quantity: 2,
      unit: "piece",
      unit_price: 100,
      pricing_source: "RESOLVED_RATE",
      discount_amount: 5,
      rate_list_id: 11,
      rate_list_version_id: 111,
      rate_list_selection_source: "LINE_OVERRIDE",
      resolved_price: resolved(10, 11, 100),
    };
    const atomic = vi.fn(async () => ({ record, items: [] }));
    const legacyHeader = vi.fn();
    const legacyLine = vi.fn();
    const repository: EstimateRepository = {
      createEstimate: legacyHeader,
      createEstimateItem: legacyLine,
      createEstimateAtomic: atomic,
    };
    const service = new DefaultEstimateService(repository);

    const result = await service.createDraft({
      definition: { organization_id: organizationId, branch_id: branchId, customer_id: 7, estimate_number: "EST-ATOMIC-1", issue_date: "2026-08-13", currency_code: "PKR" },
      lines: [line],
    }, { actor_user_id: "22222222-2222-4222-8222-222222222222", branch_id: branchId, idempotency_key: "key", source_type: "AI_ASSISTED" });

    expect(result.id).toBe(900);
    expect(atomic).toHaveBeenCalledOnce();
    expect(atomic).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({
        product_id: 10,
        rate_list_id: 11,
        rate_list_version_id: 111,
        discount_amount: 5,
        resolved_price: expect.objectContaining({ rate_list_version_id: 111 }),
      })],
    }));
    expect(legacyHeader).not.toHaveBeenCalled();
    expect(legacyLine).not.toHaveBeenCalled();
  });

  it("fails closed when a repository does not provide the atomic operation", async () => {
    const createEstimate = vi.fn();
    const createEstimateItem = vi.fn();
    const repository = { createEstimate, createEstimateItem } as unknown as EstimateRepository;
    const service = new DefaultEstimateService(repository);

    await expect(service.createDraft({
      definition: {
        organization_id: organizationId,
        branch_id: branchId,
        customer_id: 7,
        estimate_number: "EST-NON-ATOMIC",
        issue_date: "2026-08-13",
        currency_code: "PKR",
      },
      lines: [{
        line_number: 1,
        product_id: 10,
        quantity: 1,
        unit: "piece",
        unit_price: 10,
        pricing_source: "MANUAL_OVERRIDE",
      }],
    })).rejects.toThrow("atomic estimate repository operation is required");
    expect(createEstimate).not.toHaveBeenCalled();
    expect(createEstimateItem).not.toHaveBeenCalled();
  });
});
