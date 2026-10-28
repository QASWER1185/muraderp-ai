import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

export interface InvoiceSummary {
  id: number;
  source_estimate_id: number | null;
  document_template: "sanitary_electric" | "building_material";
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
  product_name?: string;
  category?: string;
  list_price?: number;
  discount_percent?: number;
  net_rate?: number;
}

export interface InvoiceBrowserRepository {
  list(organizationId: string, branchId: string, limit: number, cursor?: number): Promise<{ data: InvoiceSummary[]; next_cursor: number | null }>;
  getById(organizationId: string, branchId: string, id: number): Promise<{ invoice: InvoiceSummary; lines: InvoiceLine[] } | null>;
  listReadyEstimates(organizationId: string, branchId: string): Promise<Array<{ id: number; estimate_number: string; customer_id: number; issue_date: string }>>;
}

type UntypedClient = { from(table: string): any };
const invoiceColumns = "id, invoice_number, customer_id, source_estimate_id, document_template, warehouse_id, issue_date, status, currency_code, subtotal, discount_total, grand_total, pass_through_rent, notes";
const lineColumns = "id, line_number, product_id, quantity, unit, unit_price, line_total, unit_cost, cogs_total";

export class SupabaseInvoiceBrowserRepository implements InvoiceBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): UntypedClient {
    // The generated Database type currently omits the existing invoice tables.
    return this.clientFactory() as unknown as UntypedClient;
  }

  async getByReference(organizationId:string,branchId:string,reference:string) {
    if(/^\d+$/.test(reference))return this.getById(organizationId,branchId,Number(reference));
    const {data,error}=await this.client.from('invoices').select('id').eq('organization_id',organizationId).eq('branch_id',branchId).eq('invoice_number',reference).maybeSingle();
    if(error)throw new ApiError(502,'INVOICE_READ_FAILED','Invoice could not be loaded');
    return data?this.getById(organizationId,branchId,data.id):null;
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
    const { data: lines, error: lineError } = await this.client.from("invoice_items").select(`${lineColumns}, products!invoice_items_product_id_fkey(name,category)`)
      .eq("invoice_id", id).order("line_number", { ascending: true });
    if (lineError) throw new ApiError(502, "INVOICE_READ_FAILED", "Invoice lines could not be loaded");
    const [{ data: customer, error: customerError }, sourceItemsResult] = await Promise.all([
      this.client.from("customers").select("id,name,phone,city").eq("id", invoice.customer_id).eq("organization_id", organizationId).maybeSingle(),
      invoice.source_estimate_id == null
        ? Promise.resolve({ data: [], error: null })
        : this.client.from("estimate_items").select("line_number,quantity,unit_price,discount_amount,pricing_provenance,products!estimate_items_product_id_fkey(name,category)")
          .eq("estimate_id", invoice.source_estimate_id).order("line_number", { ascending: true }),
    ]);
    if (customerError) throw new ApiError(502, "INVOICE_READ_FAILED", "Invoice customer details could not be loaded");
    if (sourceItemsResult.error) throw new ApiError(502, "INVOICE_READ_FAILED", "Source estimate pricing details could not be loaded");
    const sourceByLine = new Map((sourceItemsResult.data ?? []).map((item: any) => [Number(item.line_number), item]));
    const detailLines = ((lines ?? []) as any[]).map((item) => {
      const source: any = sourceByLine.get(Number(item.line_number));
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      const discountAmount = Number(source?.discount_amount ?? 0);
      const listPrice = Number(source?.pricing_provenance?.list_price ?? source?.unit_price ?? unitPrice);
      const lineAmount = quantity * unitPrice - discountAmount;
      const discountPercent = Number(source?.pricing_provenance?.discount_percent ?? (listPrice * quantity > 0 ? discountAmount / (listPrice * quantity) * 100 : 0));
      return {
        ...item,
        product_name: item.products?.name ?? `Product ${item.product_id}`,
        category: item.products?.category ?? source?.products?.category ?? "Items",
        list_price: listPrice,
        discount_percent: discountPercent,
        net_rate: quantity ? lineAmount / quantity : unitPrice,
        line_total: lineAmount,
      } as InvoiceLine;
    });
    return { invoice: { ...invoice, customer } as InvoiceSummary, lines: detailLines };
  }

  async listReadyEstimates(organizationId: string, branchId: string) {
    const { data, error } = await this.client.from("estimates").select("id, estimate_number, customer_id, issue_date")
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("status", "READY")
      .order("id", { ascending: false }).limit(100);
    if (error) throw new ApiError(502, "ESTIMATE_READ_FAILED", "Ready estimates could not be loaded");
    return (data ?? []) as Array<{ id: number; estimate_number: string; customer_id: number; issue_date: string }>;
  }
}
