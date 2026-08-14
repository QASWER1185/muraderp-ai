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
  invoice: InvoiceDocument;
  warehouse_id: number;
  lines: SalesTransactionLine[];
  idempotency_key: string;
}

export interface SalesTransactionPort {
  execute(request: SalesTransactionRequest): Promise<InvoiceTransactionResult>;
}

export function assertSalesTransactionRequest(request: SalesTransactionRequest): void {
  if (request.invoice.id !== 0) {
    throw new Error("new sales transaction must not reuse an existing invoice id");
  }
  if (!Number.isInteger(request.invoice.definition.customer_id) || request.invoice.definition.customer_id <= 0) {
    throw new Error("customer_id must be a positive integer");
  }
  if (!Number.isInteger(request.warehouse_id) || request.warehouse_id <= 0) {
    throw new Error("warehouse_id must be a positive integer");
  }
  if (!request.idempotency_key.trim()) throw new Error("idempotency_key is required");
  if (request.lines.length === 0) throw new Error("invoice must contain at least one line");

  const lineNumbers = new Set<number>();
  for (const line of request.lines) {
    if (!Number.isInteger(line.line_number) || line.line_number <= 0) {
      throw new Error("line_number must be a positive integer");
    }
    if (lineNumbers.has(line.line_number)) throw new Error(`duplicate line_number ${line.line_number}`);
    lineNumbers.add(line.line_number);
    if (!Number.isInteger(line.product_id) || line.product_id <= 0) throw new Error("product_id must be a positive integer");
    if (line.quantity <= 0) throw new Error("quantity must be greater than zero");
    if (line.unit_price < 0) throw new Error("unit_price cannot be negative");
    if (line.line_total !== line.quantity * line.unit_price) throw new Error(`line_total mismatch on line ${line.line_number}`);
    if (line.unit_cost !== null && line.unit_cost < 0) throw new Error("unit_cost cannot be negative");
    if (line.cogs_total !== null && line.unit_cost === null) throw new Error("cogs_total requires unit_cost");
    if (line.cogs_total !== null && line.cogs_total !== line.quantity * line.unit_cost!) {
      throw new Error(`cogs_total mismatch on line ${line.line_number}`);
    }
  }
}
