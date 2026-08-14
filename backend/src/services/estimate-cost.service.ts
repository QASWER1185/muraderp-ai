import type { EstimateCostResolver, EstimateCostSummary, EstimateLineCost } from "../types/estimate-cost.types.js";
import type { PricedEstimateLine } from "../types/estimate.types.js";

export interface CostedEstimateLine extends PricedEstimateLine {
  cost: EstimateLineCost;
}

export interface CostedEstimate {
  lines: CostedEstimateLine[];
  summary: EstimateCostSummary;
}

export class DefaultEstimateCostService {
  constructor(private readonly resolver: EstimateCostResolver) {}

  async calculate(lines: PricedEstimateLine[], asOf: string): Promise<CostedEstimate> {
    if (!asOf || Number.isNaN(Date.parse(asOf))) {
      throw new Error("asOf must be a valid date/time");
    }

    const costedLines: CostedEstimateLine[] = [];
    let revenueTotal = 0;
    let knownCostTotal = 0;
    let hasUnknownCosts = false;

    for (const line of lines) {
      const revenue = line.quantity * line.unit_price;
      revenueTotal += revenue;
      const resolved = await this.resolver.resolveUnitCost(line.product_id, asOf);

      if (!resolved) {
        hasUnknownCosts = true;
        costedLines.push({
          ...line,
          cost: {
            cost_unit_price: null,
            cost_source: "UNKNOWN",
            cost_total: null,
            revenue_total: revenue,
            margin_amount: null,
            margin_percent: null,
            margin_status: "COST_UNKNOWN",
          },
        });
        continue;
      }

      const costTotal = line.quantity * resolved.unit_cost;
      const marginAmount = revenue - costTotal;
      knownCostTotal += costTotal;
      const marginPercent = revenue === 0 ? 0 : (marginAmount / revenue) * 100;

      costedLines.push({
        ...line,
        cost: {
          cost_unit_price: resolved.unit_cost,
          cost_source: resolved.source,
          cost_total: costTotal,
          revenue_total: revenue,
          margin_amount: marginAmount,
          margin_percent: marginPercent,
          margin_status: marginAmount > 0 ? "PROFIT" : marginAmount < 0 ? "LOSS" : "BREAK_EVEN",
        },
      });
    }

    const expectedProfit = hasUnknownCosts ? null : Math.max(revenueTotal - knownCostTotal, 0);
    const expectedLoss = hasUnknownCosts ? null : Math.max(knownCostTotal - revenueTotal, 0);
    const netMargin = hasUnknownCosts ? null : revenueTotal - knownCostTotal;
    const marginPercent = hasUnknownCosts || revenueTotal === 0 ? null : (netMargin! / revenueTotal) * 100;

    return {
      lines: costedLines,
      summary: {
        revenue_total: revenueTotal,
        cost_total: hasUnknownCosts ? null : knownCostTotal,
        expected_profit: expectedProfit,
        expected_loss: expectedLoss,
        margin_percent: marginPercent,
        status: hasUnknownCosts ? "COST_UNKNOWN" : netMargin! > 0 ? "PROFIT" : netMargin! < 0 ? "LOSS" : "BREAK_EVEN",
        has_unknown_costs: hasUnknownCosts,
      },
    };
  }
}
