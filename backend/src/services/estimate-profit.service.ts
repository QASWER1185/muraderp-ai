import type { PricedEstimateLine } from "../types/estimate.types.js";
import type {
  EstimateLineProfitAnalysis,
  EstimateMarginStatus,
  EstimateProfitSummary,
} from "../types/estimate-profit.types.js";

export interface EstimateCostResolver {
  resolveEstimatedCost(productId: number, asOf: string): Promise<number | null>;
}

function statusFor(profitLoss: number | null): EstimateMarginStatus {
  if (profitLoss === null) return "COST_UNKNOWN";
  if (profitLoss > 0) return "PROFIT";
  if (profitLoss < 0) return "LOSS";
  return "BREAK_EVEN";
}

export class DefaultEstimateProfitService {
  constructor(private readonly costResolver: EstimateCostResolver) {}

  async analyze(lines: PricedEstimateLine[], asOf: string): Promise<EstimateProfitSummary> {
    const analyses: EstimateLineProfitAnalysis[] = [];

    for (const line of lines) {
      const revenue = line.quantity * line.unit_price;
      const costUnitPrice = await this.costResolver.resolveEstimatedCost(line.product_id, asOf);
      const estimatedCost = costUnitPrice === null ? null : line.quantity * costUnitPrice;
      const profitLoss = estimatedCost === null ? null : revenue - estimatedCost;
      const margin = profitLoss === null || revenue === 0 ? null : (profitLoss / revenue) * 100;

      analyses.push({
        line_number: line.line_number,
        quantity: line.quantity,
        selling_unit_price: line.unit_price,
        estimated_cost_unit_price: costUnitPrice,
        revenue,
        estimated_cost: estimatedCost,
        estimated_profit_loss: profitLoss,
        margin_percent: margin,
        status: statusFor(profitLoss),
      });
    }

    const totalRevenue = analyses.reduce((sum, line) => sum + line.revenue, 0);
    const costKnown = analyses.every((line) => line.estimated_cost !== null);
    const totalCost = costKnown
      ? analyses.reduce((sum, line) => sum + (line.estimated_cost ?? 0), 0)
      : null;
    const profitLoss = totalCost === null ? null : totalRevenue - totalCost;

    return {
      total_revenue: totalRevenue,
      total_estimated_cost: totalCost,
      expected_profit: profitLoss !== null && profitLoss > 0 ? profitLoss : null,
      expected_loss: profitLoss !== null && profitLoss < 0 ? Math.abs(profitLoss) : null,
      expected_margin_percent: profitLoss === null || totalRevenue === 0 ? null : (profitLoss / totalRevenue) * 100,
      status: statusFor(profitLoss),
      lines: analyses,
    };
  }
}
