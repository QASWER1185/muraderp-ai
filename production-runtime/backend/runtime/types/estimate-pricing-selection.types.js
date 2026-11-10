export function assertEstimatePricingSelection(selection) {
    if (selection.mode === "RATE_LIST") {
        const rateListId = selection.rate_list_id;
        if (typeof rateListId !== "number" || !Number.isInteger(rateListId) || rateListId <= 0) {
            throw new Error("rate_list_id is required when price mode is RATE_LIST");
        }
        if (selection.manual_unit_price !== undefined && selection.manual_unit_price !== null) {
            throw new Error("manual_unit_price cannot be supplied in RATE_LIST mode");
        }
        return;
    }
    const manualUnitPrice = selection.manual_unit_price;
    if (manualUnitPrice === undefined || manualUnitPrice === null) {
        throw new Error("manual_unit_price is required when price mode is MANUAL");
    }
    if (!Number.isFinite(manualUnitPrice) || manualUnitPrice < 0) {
        throw new Error("manual_unit_price must be zero or greater");
    }
}
//# sourceMappingURL=estimate-pricing-selection.types.js.map