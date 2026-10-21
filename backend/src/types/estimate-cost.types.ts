export type EstimateMarginStatus = "PROFIT" | "LOSS" | "BREAK_EVEN" | "COST_UNKNOWN";

export interface EstimateLineCost {
  cost_unit_price: number | null;
  cost_source: "PURCHASE_RATE" | "INVENTORY_COST" | "MANUAL_COST" | "UNKNOWN";
  cost_total: number | null;
  revenue_total: number;
  margin_amount: number | null;
  margin_percent: number | null;
  margin_status: EstimateMarginStatus;
}

export interface EstimateCostSummary {
  revenue_total: number;
  cost_total: number | null;
  expected_profit: number | null;
  expected_loss: number | null;
  margin_percent: number | null;
  status: EstimateMarginStatus;
  has_unknown_costs: boolean;
}

/**
 * Cost is a snapshot/estimate for commercial decision support. It does not
 * replace the accounting engine's eventual COGS calculation at invoicing.
 */
export interface EstimateCostResolver {
  resolveUnitCost(productId: number, asOf: string): Promise<{
    unit_cost: number;
    source: Exclude<EstimateLineCost["cost_source"], "UNKNOWN">;
  } | null>;
}
