import type { InvoiceDocument, InvoiceTransactionResult } from "./invoice.types.js";

export interface SalesTransactionLine {
  line_number: number;
  product_id: number;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  unit_cost: number | null;
  cogs_total: number | null;
}

export interface SalesTransactionRequest {
  organization_id: string;
  branch_id: string | null;
  actor_user_id: string;
  invoice: InvoiceDocument;
  warehouse_id: number;
  lines: SalesTransactionLine[];
  idempotency_key: string;
}

export interface SalesTransactionPort {
  execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const closeEnough = (left: number, right: number) => Math.abs(left - right) <= 0.000001;

export function assertSalesTransactionRequest(request: SalesTransactionRequest): void {
  if (!UUID_PATTERN.test(request.organization_id)) throw new Error("organization_id must be a UUID");
  if (!UUID_PATTERN.test(request.actor_user_id)) throw new Error("actor_user_id must be a UUID");
  if (request.branch_id !== null && !UUID_PATTERN.test(request.branch_id)) throw new Error("branch_id must be a UUID when provided");
  if (request.invoice.id !== 0) throw new Error("new sales transaction must not reuse an existing invoice id");
  if (!Number.isInteger(request.invoice.definition.customer_id) || request.invoice.definition.customer_id <= 0) {
    throw new Error("customer_id must be a positive integer");
  }
  if (!Number.isInteger(request.warehouse_id) || request.warehouse_id <= 0) throw new Error("warehouse_id must be a positive integer");
  if (!request.idempotency_key.trim() || request.idempotency_key.length > 255) throw new Error("idempotency_key is required and must be at most 255 characters");
  if (request.lines.length === 0) throw new Error("invoice must contain at least one line");
  if (request.invoice.discount_total > request.invoice.subtotal) throw new Error("discount_total cannot exceed subtotal");
  if (!closeEnough(request.invoice.grand_total, request.invoice.subtotal - request.invoice.discount_total)) {
    throw new Error("grand_total must equal subtotal minus discount");
  }
  if (request.invoice.source_type === "DIRECT" && request.invoice.source_estimate_id !== null) throw new Error("DIRECT invoice cannot have source_estimate_id");
  if (request.invoice.source_type === "FROM_ESTIMATE" && request.invoice.source_estimate_id === null) throw new Error("FROM_ESTIMATE invoice requires source_estimate_id");

  const lineNumbers = new Set<number>();
  let lineSubtotal = 0;
  for (const line of request.lines) {
    if (!Number.isInteger(line.line_number) || line.line_number <= 0) throw new Error("line_number must be a positive integer");
    if (lineNumbers.has(line.line_number)) throw new Error(`duplicate line_number ${line.line_number}`);
    lineNumbers.add(line.line_number);
    if (!Number.isInteger(line.product_id) || line.product_id <= 0) throw new Error("product_id must be a positive integer");
    if (line.quantity <= 0) throw new Error("quantity must be greater than zero");
    if (!line.unit.trim()) throw new Error("unit is required");
    if (line.unit_price < 0) throw new Error("unit_price cannot be negative");
    if (!closeEnough(line.line_total, line.quantity * line.unit_price)) throw new Error(`line_total mismatch on line ${line.line_number}`);
    if (line.unit_cost === null || line.cogs_total === null) throw new Error("posted sales require explicit unit_cost and cogs_total; costing is not inferred");
    if (line.unit_cost < 0) throw new Error("unit_cost cannot be negative");
    if (!closeEnough(line.cogs_total, line.quantity * line.unit_cost)) throw new Error(`cogs_total mismatch on line ${line.line_number}`);
    lineSubtotal += line.line_total;
  }
  if (!closeEnough(lineSubtotal, request.invoice.subtotal)) throw new Error("subtotal must equal the invoice line totals");
}
