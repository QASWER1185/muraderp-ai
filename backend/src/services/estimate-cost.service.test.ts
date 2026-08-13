import { describe, expect, it } from "vitest";
import { DefaultEstimateCostService } from "./estimate-cost.service.js";
import type { EstimateCostResolver } from "../types/estimate-cost.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

const lines: PricedEstimateLine[] = [
  { line_number: 1, product_id: 10, quantity: 10, unit: "bag", unit_price: 1200, pricing_source: "RESOLVED_RATE" },
  { line_number: 2, product_id: 11, quantity: 5, unit: "piece", unit_price: 500, pricing_source: "MANUAL_OVERRIDE" },
];

function resolver(): EstimateCostResolver {
  return {
    resolveUnitCost: async (productId) => productId === 10
      ? { unit_cost: 1000, source: "PURCHASE_RATE" }
      : { unit_cost: 600, source: "INVENTORY_COST" },
  };
}

describe("DefaultEstimateCostService", () => {
  it("shows expected profit when selling above cost", async () => {
    const result = await new DefaultEstimateCostService(resolver()).calculate(lines, "2026-08-13T10:00:00Z");
    const firstLine = result.lines[0]!;
    const secondLine = result.lines[1]!;

    expect(result.summary.revenue_total).toBe(14500);
    expect(result.summary.cost_total).toBe(13000);
    expect(result.summary.expected_profit).toBe(1500);
    expect(result.summary.expected_loss).toBe(0);
    expect(result.summary.status).toBe("PROFIT");
    expect(firstLine.cost.margin_amount).toBe(2000);
    expect(secondLine.cost.margin_amount).toBe(-500);
  });

  it("shows loss when the estimate is below cost", async () => {
    const lossLines: PricedEstimateLine[] = [
      { line_number: 1, product_id: 10, quantity: 10, unit: "bag", unit_price: 800, pricing_source: "MANUAL_OVERRIDE" },
    ];

    const result = await new DefaultEstimateCostService(resolver()).calculate(lossLines, "2026-08-13T10:00:00Z");

    expect(result.summary.revenue_total).toBe(8000);
    expect(result.summary.cost_total).toBe(10000);
    expect(result.summary.expected_profit).toBe(0);
    expect(result.summary.expected_loss).toBe(2000);
    expect(result.summary.status).toBe("LOSS");
  });

  it("does not pretend to know profit when a cost is unavailable", async () => {
    const unknownResolver: EstimateCostResolver = {
      resolveUnitCost: async () => null,
    };

    const result = await new DefaultEstimateCostService(unknownResolver).calculate(lines, "2026-08-13T10:00:00Z");

    expect(result.summary.status).toBe("COST_UNKNOWN");
    expect(result.summary.expected_profit).toBeNull();
    expect(result.summary.expected_loss).toBeNull();
    expect(result.summary.has_unknown_costs).toBe(true);
  });
});
