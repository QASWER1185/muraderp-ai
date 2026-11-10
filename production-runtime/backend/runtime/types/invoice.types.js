export function buildInvoiceFromEstimate(estimate, definition, id = 0) {
    return {
        id,
        status: "DRAFT",
        source_estimate_id: estimate.id,
        source_type: "FROM_ESTIMATE",
        definition,
        lines: estimate.lines,
        subtotal: estimate.totals.subtotal,
        discount_total: estimate.totals.discount_total,
        grand_total: estimate.totals.grand_total,
        pass_through_rent: estimate.totals.pass_through_rent,
        document_template: estimate.definition.document_template ?? "sanitary_electric",
    };
}
/** Direct invoice entry does not require an Estimate. */
export function buildDirectInvoice(definition, lines, subtotal, discount_total, grand_total, pass_through_rent, id = 0, document_template = "sanitary_electric") {
    return {
        id,
        status: "DRAFT",
        source_estimate_id: null,
        source_type: "DIRECT",
        definition,
        lines,
        subtotal,
        discount_total,
        grand_total,
        pass_through_rent,
        document_template,
    };
}
//# sourceMappingURL=invoice.types.js.map