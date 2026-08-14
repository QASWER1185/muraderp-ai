export type EstimateMarginStatus = "PROFIT" | "LOSS" | "BREAK_EVEN" | "COST_UNKNOWN";

export interface EstimateLineProfitAnalysis {
  line_number: number;
  quantity: number;
  selling_unit_price: number;
  estimated_cost_unit_price: number | null;
  revenue: number;
  estimated_cost: number | null;
  estimated_profit_loss: number | null;
  margin_percent: number | null;
  status: EstimateMarginStatus;
}

export interface EstimateProfitSummary {
  total_revenue: number;
  total_estimated_cost: number | null;
  expected_profit: number | null;
  expected_loss: number | null;
  expected_margin_percent: number | null;
  status: EstimateMarginStatus;
  lines: EstimateLineProfitAnalysis[];
}
