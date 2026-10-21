export type InvoiceStatus = "DRAFT" | "POSTED" | "VOID";

export interface InvoicePostingLine {
  line_number: number;
  product_id: number;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  estimated_cost: number | null;
}

export interface InvoicePostingRequest {
  invoice_id: number;
  customer_id: number;
  lines: InvoicePostingLine[];
  subtotal: number;
  discount_total: number;
  grand_total: number;
  pass_through_rent: number;
}

export interface InvoicePostingResult {
  invoice_id: number;
  status: "POSTED";
  inventory_mutated: boolean;
  receivable_created: boolean;
  accounting_entry_created: boolean;
  pass_through_rent_recorded: boolean;
}
