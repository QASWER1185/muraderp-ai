import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

export interface InvoiceSummary {
  id: number;
  invoice_number: string;
  customer_id: number;
  warehouse_id: number | null;
  issue_date: string;
  status: string;
  currency_code: string;
  subtotal: number;
  discount_total: number;
  grand_total: number;
  pass_through_rent: number;
  notes: string | null;
}

export interface InvoiceLine {
  id: number;
  line_number: number;
  product_id: number;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  unit_cost: number | null;
  cogs_total: number | null;
}

export interface InvoiceBrowserRepository {
  list(organizationId: string, branchId: string, limit: number, cursor?: number): Promise<{ data: InvoiceSummary[]; next_cursor: number | null }>;
  getById(organizationId: string, branchId: string, id: number): Promise<{ invoice: InvoiceSummary; lines: InvoiceLine[] } | null>;
  listReadyEstimates(organizationId: string, branchId: string): Promise<Array<{ id: number; estimate_number: string; customer_id: number; issue_date: string }>>;
}

type UntypedClient = { from(table: string): any };
const invoiceColumns = "id, invoice_number, customer_id, warehouse_id, issue_date, status, currency_code, subtotal, discount_total, grand_total, pass_through_rent, notes";
const lineColumns = "id, line_number, product_id, quantity, unit, unit_price, line_total, unit_cost, cogs_total";

export class SupabaseInvoiceBrowserRepository implements InvoiceBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): UntypedClient {
    // The generated Database type currently omits the existing invoice tables.
    return this.clientFactory() as unknown as UntypedClient;
  }

  async list(organizationId: string, branchId: string, limit: number, cursor?: number) {
    let query = this.client.from("invoices").select(invoiceColumns)
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    const { data, error } = await query;
    if (error) throw new ApiError(502, "INVOICE_READ_FAILED", "Invoices could not be loaded");
    const rows = (data ?? []) as InvoiceSummary[];
    return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }

  async getById(organizationId: string, branchId: string, id: number) {
    const { data: invoice, error } = await this.client.from("invoices").select(invoiceColumns)
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle();
    if (error) throw new ApiError(502, "INVOICE_READ_FAILED", "Invoice could not be loaded");
    if (!invoice) return null;
    const { data: lines, error: lineError } = await this.client.from("invoice_items").select(lineColumns)
      .eq("invoice_id", id).order("line_number", { ascending: true });
    if (lineError) throw new ApiError(502, "INVOICE_READ_FAILED", "Invoice lines could not be loaded");
    return { invoice: invoice as InvoiceSummary, lines: (lines ?? []) as InvoiceLine[] };
  }

  async listReadyEstimates(organizationId: string, branchId: string) {
    const { data, error } = await this.client.from("estimates").select("id, estimate_number, customer_id, issue_date")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("status", "READY")
      .order("id", { ascending: false }).limit(100);
    if (error) throw new ApiError(502, "ESTIMATE_READ_FAILED", "Ready estimates could not be loaded");
    return (data ?? []) as Array<{ id: number; estimate_number: string; customer_id: number; issue_date: string }>;
  }
}
