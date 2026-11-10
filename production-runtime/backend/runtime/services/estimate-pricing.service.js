export class DefaultEstimatePricingService {
    pricingService;
    constructor(pricingService) {
        this.pricingService = pricingService;
    }
    async priceLine(line, context) {
        if (!Number.isInteger(line.line_number) || line.line_number <= 0) {
            throw new Error("line_number must be a positive integer");
        }
        if (!Number.isInteger(line.product_id) || line.product_id <= 0) {
            throw new Error("product_id must be a positive integer");
        }
        if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
            throw new Error("quantity must be greater than zero");
        }
        if (!line.unit.trim()) {
            throw new Error("unit is required");
        }
        if (line.brand_hint?.trim() && line.rate_list_id == null) {
            throw new Error("brand_hint requires an explicit line-level rate_list_id");
        }
        // Re-validating a deterministically priced line must not turn its saved
        // resolved rate into a manual override (the Copilot path validates twice).
        if (line.unit_price !== undefined && line.pricing_source !== "RESOLVED_RATE") {
            if (!Number.isFinite(line.unit_price) || line.unit_price < 0) {
                throw new Error("unit_price must be zero or greater");
            }
            return {
                ...line,
                unit: line.unit.trim(),
                unit_price: line.unit_price,
                pricing_source: "MANUAL_OVERRIDE",
                rate_list_selection_source: "MANUAL_OVERRIDE",
            };
        }
        const selectedRateListId = line.rate_list_id ?? context.rate_list_id ?? null;
        const selectionSource = line.rate_list_id != null ? (line.rate_list_selection_source ?? "LINE_OVERRIDE") : "ESTIMATE_DEFAULT";
        const resolutionContext = {
            ...context,
            product_id: line.product_id,
            quantity: line.quantity,
            rate_list_id: selectedRateListId,
        };
        const resolved = await this.pricingService.resolvePrice(resolutionContext);
        if (!resolved) {
            throw new Error(`no applicable price found for product_id ${line.product_id}`);
        }
        return {
            ...line,
            unit: resolved.unit,
            unit_price: resolved.unit_price,
            pricing_source: "RESOLVED_RATE",
            rate_list_id: resolved.rate_list_id,
            rate_list_version_id: resolved.rate_list_version_id,
            rate_list_selection_source: selectionSource,
            resolved_price: resolved,
        };
    }
}
//# sourceMappingURL=estimate-pricing.service.js.map