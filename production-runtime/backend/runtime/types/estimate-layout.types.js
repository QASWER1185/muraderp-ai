export const DEFAULT_BUSINESS_HEADER = {
    business_name: "M MURAD BUILDING MATERIALS STORE",
    tagline: "SANITARY | ELECTRIC | CEMENT | BRICKS",
    address: "Al Kabir Town, Raiwind Road, Lahore",
    phone: "03086235608",
    logo_url: null,
};
export const ESTIMATE_COLUMNS = [
    { key: "item_number", label: "No.", position: 1 },
    { key: "item_name", label: "Item", position: 2 },
    { key: "quantity", label: "Qty", position: 3 },
    { key: "rate", label: "Rate", position: 4 },
    { key: "line_total", label: "Total", position: 5 },
];
export const ESTIMATE_SUMMARY_ORDER = [
    "TOTAL",
    "DISCOUNT",
    "GRAND_TOTAL",
    "RENT",
    "NET_PAYABLE",
];
const base = {
    columns: ESTIMATE_COLUMNS,
    summary_order: ESTIMATE_SUMMARY_ORDER,
};
export const DEFAULT_ESTIMATE_LAYOUTS = [
    { ...base, key: "CLASSIC_PAKISTAN", name: "Classic Pakistan", description: "Traditional local-market quotation/estimate layout.", show_logo: true, show_customer_address: true, show_product_description: true, show_discount: true, show_tax: true, show_pass_through_rent: true, show_cost_analysis: false, show_profit_loss: false, show_notes: true, show_signature: true },
    { ...base, key: "MODERN_PAKISTAN", name: "Modern Pakistan", description: "Modern branded layout for professional building-material businesses.", show_logo: true, show_customer_address: true, show_product_description: true, show_discount: true, show_tax: true, show_pass_through_rent: true, show_cost_analysis: true, show_profit_loss: true, show_notes: true, show_signature: true },
    { ...base, key: "COMPACT_TRADE", name: "Compact Trade", description: "Dense trade-counter layout for many line items.", show_logo: true, show_customer_address: false, show_product_description: false, show_discount: true, show_tax: false, show_pass_through_rent: true, show_cost_analysis: false, show_profit_loss: false, show_notes: false, show_signature: false },
    { ...base, key: "DETAILED_COMMERCIAL", name: "Detailed Commercial", description: "Detailed commercial quotation with transparent pricing analysis.", show_logo: true, show_customer_address: true, show_product_description: true, show_discount: true, show_tax: true, show_pass_through_rent: true, show_cost_analysis: true, show_profit_loss: true, show_notes: true, show_signature: true },
    { ...base, key: "MINIMAL_CLEAN", name: "Minimal Clean", description: "Simple clean professional document.", show_logo: true, show_customer_address: false, show_product_description: true, show_discount: true, show_tax: false, show_pass_through_rent: true, show_cost_analysis: false, show_profit_loss: false, show_notes: true, show_signature: true },
];
//# sourceMappingURL=estimate-layout.types.js.map