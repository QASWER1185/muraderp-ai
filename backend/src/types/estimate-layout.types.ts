export type EstimateLayoutKey =
  | "CLASSIC_PAKISTAN"
  | "MODERN_PAKISTAN"
  | "COMPACT_TRADE"
  | "DETAILED_COMMERCIAL"
  | "MINIMAL_CLEAN";

export interface EstimateLayoutDefinition {
  key: EstimateLayoutKey;
  name: string;
  description: string;
  show_logo: boolean;
  show_customer_address: boolean;
  show_product_description: boolean;
  show_discount: boolean;
  show_tax: boolean;
  show_pass_through_rent: boolean;
  show_cost_analysis: boolean;
  show_profit_loss: boolean;
  show_notes: boolean;
  show_signature: boolean;
}

export const DEFAULT_ESTIMATE_LAYOUTS: readonly EstimateLayoutDefinition[] = [
  {
    key: "CLASSIC_PAKISTAN",
    name: "Classic Pakistan",
    description: "Traditional local-market quotation/estimate layout with clear totals and signature area.",
    show_logo: true,
    show_customer_address: true,
    show_product_description: true,
    show_discount: true,
    show_tax: true,
    show_pass_through_rent: true,
    show_cost_analysis: false,
    show_profit_loss: false,
    show_notes: true,
    show_signature: true,
  },
  {
    key: "MODERN_PAKISTAN",
    name: "Modern Pakistan",
    description: "Modern branded layout suitable for professional building-material businesses.",
    show_logo: true,
    show_customer_address: true,
    show_product_description: true,
    show_discount: true,
    show_tax: true,
    show_pass_through_rent: true,
    show_cost_analysis: true,
    show_profit_loss: true,
    show_notes: true,
    show_signature: true,
  },
  {
    key: "COMPACT_TRADE",
    name: "Compact Trade",
    description: "Dense trade-counter layout for quick estimates with many line items.",
    show_logo: true,
    show_customer_address: false,
    show_product_description: false,
    show_discount: true,
    show_tax: false,
    show_pass_through_rent: true,
    show_cost_analysis: false,
    show_profit_loss: false,
    show_notes: false,
    show_signature: false,
  },
  {
    key: "DETAILED_COMMERCIAL",
    name: "Detailed Commercial",
    description: "Detailed layout for larger commercial quotations and transparent pricing analysis.",
    show_logo: true,
    show_customer_address: true,
    show_product_description: true,
    show_discount: true,
    show_tax: true,
    show_pass_through_rent: true,
    show_cost_analysis: true,
    show_profit_loss: true,
    show_notes: true,
    show_signature: true,
  },
  {
    key: "MINIMAL_CLEAN",
    name: "Minimal Clean",
    description: "Simple clean layout for customers who prefer a short professional document.",
    show_logo: true,
    show_customer_address: false,
    show_product_description: true,
    show_discount: true,
    show_tax: false,
    show_pass_through_rent: true,
    show_cost_analysis: false,
    show_profit_loss: false,
    show_notes: true,
    show_signature: true,
  },
];
