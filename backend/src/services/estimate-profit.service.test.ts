import { describe, expect, it } from "vitest";
import { DefaultEstimateProfitService, type EstimateCostResolver } from "./estimate-profit.service.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

const lines: PricedEstimateLine[] = [
  { line_number: 1, product_id: 10, quantity: 10, unit: "bag", unit_price: 1200, pricing_source: "RESOLVED_RATE" },
  { line_number: 2, product_id: 11, quantity: 5, unit: "piece", unit_price: 800, pricing_source: "MANUAL_OVERRIDE" },
];

function resolver(values: Record<number, number | null>): EstimateCostResolver {
  return { resolveEstimatedCost: async (productId) => values[productId] ?? null };
}

describe("DefaultEstimateProfitService", () => {
  it("calculates expected profit and margin", async () => {
    const service = new DefaultEstimateProfitService(resolver({ 10: 1000, 11: 500 }));
    const result = await service.analyze(lines, "2026-08-13T10:00:00Z");

    expect(result.total_revenue).toBe(16000);
    expect(result.total_estimated_cost).toBe(12500);
    expect(result.expected_profit).toBe(3500);
    expect(result.expected_loss).toBeNull();
    expect(result.status).toBe("PROFIT");
  });

  it("identifies an estimated loss", async () => {
    const service = new DefaultEstimateProfitService(resolver({ 10: 1400, 11: 900 }));
    const result = await service.analyze(lines, "2026-08-13T10:00:00Z");

    expect(result.expected_profit).toBeNull();
    expect(result.expected_loss).toBe(4500);
    expect(result.status).toBe("LOSS");
  });

  it("does not invent a profit when any cost is unknown", async () => {
    const service = new DefaultEstimateProfitService(resolver({ 10: 1000, 11: null }));
    const result = await service.analyze(lines, "2026-08-13T10:00:00Z");

    expect(result.total_estimated_cost).toBeNull();
    expect(result.expected_profit).toBeNull();
    expect(result.expected_loss).toBeNull();
    expect(result.status).toBe("COST_UNKNOWN");
  });
});
