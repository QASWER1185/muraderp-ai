import { describe, expect, it } from "vitest";
import { DefaultEstimateService } from "./estimate.service.js";
import type { EstimateRepository, EstimateRecord } from "../repositories/estimate.repository.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";
import type { PricingService } from "./pricing.service.js";
import type { ResolvedPrice } from "../types/pricing.types.js";

const lines: PricedEstimateLine[] = [
  {
    line_number: 1,
    product_id: 10,
    quantity: 20,
    unit: "bag",
    unit_price: 1450,
    pricing_source: "RESOLVED_RATE",
  },
  {
    line_number: 2,
    product_id: 11,
    quantity: 10,
    unit: "piece",
    unit_price: 500,
    pricing_source: "MANUAL_OVERRIDE",
  },
];

const resolvedPrice: ResolvedPrice = {
  rate_list_id: 22,
  rate_list_version_id: 3,
  rate_list_item_id: 4,
  product_id: 10,
  unit_price: 1450,
  unit: "bag",
  currency_code: "PKR",
  minimum_quantity: 1,
  scope_type: "CUSTOMER",
  effective_from: "2026-08-13T00:00:00Z",
};

function repository(): EstimateRepository {
  const record: EstimateRecord = {
    id: 100,
    customer_id: 7,
    estimate_number: "EST-0001",
    issue_date: "2026-08-13",
    currency_code: "PKR",
    notes: null,
    status: "DRAFT",
    source_type: "MANUAL",
    source_reference: null,
    created_at: "2026-08-13T10:00:00Z",
    updated_at: "2026-08-13T10:00:00Z",
  };

  return {
    createEstimate: async () => record,
    createEstimateItem: async (estimateId, line) => ({
      id: line.line_number,
      estimate_id: estimateId,
      line_number: line.line_number,
      product_id: line.product_id,
      description: null,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unit_price,
      discount_amount: 0,
      pricing_source: line.pricing_source,
      rate_list_id: line.resolved_price?.rate_list_id ?? line.rate_list_id ?? null,
      rate_list_version_id: line.resolved_price?.rate_list_version_id ?? null,
      created_at: "2026-08-13T10:00:00Z",
      updated_at: "2026-08-13T10:00:00Z",
    }),
  };
}

function pricingService(value: ResolvedPrice | null): PricingService {
  return {
    resolvePrice: async (context) => {
      expect(context.price_type).toBe("SALE");
      expect(context.customer_id).toBe(7);
      return value;
    },
    resolveCandidate: async (candidate, context) => {
      expect(candidate.product_id).toBe(10);
      expect(candidate.quantity).toBe(50);
      expect(candidate.rate_list_hint).toBe("Popular");
      expect(candidate.selection_source).toBe("OCR_BRAND_MATCH");
      expect(context.price_type).toBe("SALE");
      return value;
    },
  };
}

describe("DefaultEstimateService", () => {
  it("creates a draft and calculates totals from priced lines", async () => {
    const service = new DefaultEstimateService(repository());

    const result = await service.createDraft({
      definition: {
        customer_id: 7,
        estimate_number: "EST-0001",
        issue_date: "2026-08-13",
        currency_code: "PKR",
      },
      lines,
    });

    expect(result.status).toBe("DRAFT");
    expect(result.totals).toEqual({
      subtotal: 34000,
      discount_total: 0,
      grand_total: 34000,
      pass_through_rent: 0,
      customer_payable_total: 34000,
    });
    expect(result.lines).toHaveLength(2);
  });

  it("automatically resolves estimate rates from the selected estimate rate list", async () => {
    const service = new DefaultEstimateService(repository(), pricingService(resolvedPrice));

    const result = await service.createDraft({
      definition: {
        customer_id: 7,
        estimate_number: "EST-0004",
        issue_date: "2026-08-13",
        currency_code: "PKR",
        default_rate_list_id: 22,
      },
      lines: [{
        line_number: 1,
        product_id: 10,
        quantity: 50,
        unit: "bag",
      }],
    });

    expect(result.lines[0]).toMatchObject({
      unit_price: 1450,
      pricing_source: "RESOLVED_RATE",
      rate_list_id: 22,
      resolved_price: resolvedPrice,
    });
    expect(result.totals.subtotal).toBe(72500);
  });

  it("uses an explicit brand/rate-list hint from AI or OCR through the canonical resolver", async () => {
    const service = new DefaultEstimateService(repository(), pricingService(resolvedPrice));

    const result = await service.createDraft({
      definition: {
        customer_id: 7,
        estimate_number: "EST-0007",
        issue_date: "2026-08-13",
        currency_code: "PKR",
      },
      lines: [{
        line_number: 1,
        product_id: 10,
        quantity: 50,
        unit: "bag",
        brand_hint: "Popular",
      }],
    });

    expect(result.lines[0]).toMatchObject({
      unit_price: 1450,
      pricing_source: "RESOLVED_RATE",
      rate_list_selection_source: "OCR_BRAND_MATCH",
      rate_list_id: 22,
    });
  });

  it("keeps manual line rates as explicit overrides", async () => {
    const service = new DefaultEstimateService(repository(), pricingService(resolvedPrice));

    const result = await service.createDraft({
      definition: {
        customer_id: 7,
        estimate_number: "EST-0005",
        issue_date: "2026-08-13",
        currency_code: "PKR",
        default_rate_list_id: 22,
      },
      lines: [{
        line_number: 1,
        product_id: 10,
        quantity: 50,
        unit: "bag",
        unit_price: 1500,
      }],
    });

    expect(result.lines[0]).toMatchObject({
      unit_price: 1500,
      pricing_source: "MANUAL_OVERRIDE",
    });
  });

  it("fails safely when automatic pricing cannot resolve a rate", async () => {
    const service = new DefaultEstimateService(repository(), pricingService(null));

    await expect(service.createDraft({
      definition: {
        customer_id: 7,
        estimate_number: "EST-0006",
        issue_date: "2026-08-13",
        currency_code: "PKR",
        default_rate_list_id: 22,
      },
      lines: [{
        line_number: 1,
        product_id: 999,
        quantity: 10,
        unit: "piece",
      }],
    })).rejects.toThrow("no applicable price found for product_id 999");
  });

  it("rejects an estimate without lines", async () => {
    const service = new DefaultEstimateService(repository());
    await expect(
      service.createDraft({
        definition: {
          customer_id: 7,
          estimate_number: "EST-0002",
          issue_date: "2026-08-13",
          currency_code: "PKR",
        },
        lines: [],
      }),
    ).rejects.toThrow("estimate must contain at least one line");
  });

  it("rejects duplicate line numbers", async () => {
    const service = new DefaultEstimateService(repository());
    const firstLine = lines[0]!;
    const secondLine = lines[1]!;

    await expect(
      service.createDraft({
        definition: {
          customer_id: 7,
          estimate_number: "EST-0003",
          issue_date: "2026-08-13",
          currency_code: "PKR",
        },
        lines: [firstLine, { ...secondLine, line_number: 1 }],
      }),
    ).rejects.toThrow("duplicate line_number 1");
  });
});
