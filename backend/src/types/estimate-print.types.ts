import type { EstimateRenderModel } from "./estimate-render.types.js";

export type EstimateOutputFormat = "PRINT" | "PDF" | "SHARE";

export interface PrintableEstimateDocument {
  format: EstimateOutputFormat;
  title: "ESTIMATE";
  model: EstimateRenderModel;
  customer_payable_total: number;
  business_revenue_total: number;
  pass_through_rent: number;
}

export function buildPrintableEstimate(
  model: EstimateRenderModel,
  format: EstimateOutputFormat,
): PrintableEstimateDocument {
  return {
    format,
    title: "ESTIMATE",
    model,
    customer_payable_total: model.estimate.totals.customer_payable_total,
    business_revenue_total: model.estimate.totals.subtotal - model.estimate.totals.discount_total,
    pass_through_rent: model.estimate.totals.pass_through_rent,
  };
}
