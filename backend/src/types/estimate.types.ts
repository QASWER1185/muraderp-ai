import type { PriceResolutionContext, RateListSelectionSource, ResolvedPrice } from "./pricing.types.js";

export interface EstimateLinePricingContext extends PriceResolutionContext {
  line_number: number;
}

export interface EstimateLineDraft {
  description?: string | null;
  line_number: number;
  product_id: number;
  quantity: number;
  unit: string;
  unit_price?: number;
  discount_amount?: number;
  pricing_source?: "RESOLVED_RATE" | "MANUAL_OVERRIDE";
  /** Explicit rate-list choice for mixed-brand estimates. */
  rate_list_id?: number | null;
  /** Exact version selected by deterministic pricing, when available. */
  rate_list_version_id?: number | null;
  rate_list_selection_source?: RateListSelectionSource;
  /** OCR/AI may capture the brand text; matching remains a controlled pricing decision. */
  brand_hint?: string | null;
}

export interface PricedEstimateLine extends EstimateLineDraft {
  unit_price: number;
  pricing_source: "RESOLVED_RATE" | "MANUAL_OVERRIDE";
  resolved_price?: ResolvedPrice;
}

/**
 * Estimates consume the same deterministic pricing engine as sales.
 * AI/OCR may create EstimateLineDraft values, but pricing is resolved by the
 * application layer and is never implicitly granted database mutation access.
 */
export interface EstimatePricingService {
  priceLine(
    line: EstimateLineDraft,
    context: Omit<EstimateLinePricingContext, "product_id" | "quantity" | "line_number">,
  ): Promise<PricedEstimateLine>;
}
