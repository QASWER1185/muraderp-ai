import type { EstimateLineDraft, PricedEstimateLine, EstimatePricingService } from "../types/estimate.types.js";
import type { PriceResolutionContext, PricingCandidate } from "../types/pricing.types.js";
import type { PricingService } from "./pricing.service.js";

export class DefaultEstimatePricingService implements EstimatePricingService {
  constructor(private readonly pricingService: PricingService) {}

  async priceLine(
    line: EstimateLineDraft,
    context: Omit<PriceResolutionContext, "product_id" | "quantity" | "rate_list_id">,
  ): Promise<PricedEstimateLine> {
    if (line.unit_price !== undefined) {
      if (!Number.isFinite(line.unit_price) || line.unit_price < 0) throw new Error("unit_price must be zero or greater");
      return { ...line, unit_price: line.unit_price, pricing_source: "MANUAL_OVERRIDE" };
    }

    const selectedRateListId = line.rate_list_id ?? null;
    const selectionSource = line.rate_list_selection_source ??
      (selectedRateListId != null ? "ESTIMATE_DEFAULT" : "MANUAL_OVERRIDE");

    const resolved = await this.pricingService.resolveCandidate(
      {
        product_id: line.product_id,
        quantity: line.quantity,
        selected_rate_list_id: selectedRateListId,
        rate_list_hint: line.brand_hint ?? null,
        selection_source: selectionSource,
      } satisfies PricingCandidate,
      context,
    );

    if (!resolved) throw new Error(`unable to resolve price for estimate line ${line.line_number}`);

    return {
      ...line,
      rate_list_id: selectedRateListId,
      rate_list_selection_source: selectionSource,
      unit_price: resolved.unit_price,
      pricing_source: "RESOLVED_RATE",
      resolved_price: resolved,
    };
  }
}
