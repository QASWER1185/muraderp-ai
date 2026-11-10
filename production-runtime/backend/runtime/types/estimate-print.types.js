export function buildPrintableEstimate(model, format) {
    return {
        format,
        title: "ESTIMATE",
        model,
        customer_payable_total: model.estimate.totals.customer_payable_total,
        business_revenue_total: model.estimate.totals.subtotal - model.estimate.totals.discount_total,
        pass_through_rent: model.estimate.totals.pass_through_rent,
    };
}
//# sourceMappingURL=estimate-print.types.js.map