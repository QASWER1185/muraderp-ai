import { describe, expect, it } from "vitest";
import { DefaultEstimateService } from "./estimate.service.js";
import type { EstimateRepository, EstimateRecord } from "../repositories/estimate.repository.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

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
      rate_list_id: null,
      rate_list_version_id: null,
      created_at: "2026-08-13T10:00:00Z",
      updated_at: "2026-08-13T10:00:00Z",
    }),
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
