import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database } from "../types/database.types.js";

export interface CreditNoteSummary {
  id: number;
  credit_note_number: string;
  invoice_id: number;
  customer_id: number;
  credit_date: string;
  currency_code: string;
  status: string;
  subtotal: number;
  grand_total: number;
  reason: string;
  notes: string | null;
}

export interface CreditNoteLine {
  id: number;
  invoice_item_id: number;
  product_id: number;
  warehouse_id: number;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
}

export interface SalesReturnBrowserRepository {
  list(organizationId: string, branchId: string, limit: number, cursor?: number, search?: string): Promise<{ data: CreditNoteSummary[]; next_cursor: number | null }>;
  getById(organizationId: string, branchId: string, id: number): Promise<{ credit_note: CreditNoteSummary; items: CreditNoteLine[] } | null>;
}

const noteColumns = "id, credit_note_number, invoice_id, customer_id, credit_date, currency_code, status, subtotal, grand_total, reason, notes";
const lineColumns = "id, invoice_item_id, product_id, warehouse_id, quantity, unit, unit_price, line_total";
type UntypedClient = { from(table: string): any };

export class SupabaseSalesReturnBrowserRepository implements SalesReturnBrowserRepository {
  constructor(private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseServiceRoleClient) {}

  private get client(): UntypedClient {
    // Generated database types lag the scoped credit-note columns in the active migration.
    return this.clientFactory() as unknown as UntypedClient;
  }

  async list(organizationId: string, branchId: string, limit: number, cursor?: number, search?: string) {
    let query = this.client.from("credit_notes").select(noteColumns)
      .eq("organization_id", organizationId).eq("branch_id", branchId)
      .order("id", { ascending: false }).limit(limit + 1);
    if (cursor !== undefined) query = query.lt("id", cursor);
    if (search) {
      const invoiceId = /^\d+$/.test(search) ? Number(search) : NaN;
      query = Number.isSafeInteger(invoiceId) && invoiceId > 0
        ? query.eq("invoice_id", invoiceId)
        : query.ilike("credit_note_number", `%${search}%`);
    }
    const { data, error } = await query;
    if (error) throw new ApiError(502, "RETURN_READ_FAILED", "Returns could not be loaded");
    const rows = (data ?? []) as CreditNoteSummary[];
    return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
  }

  async getById(organizationId: string, branchId: string, id: number) {
    const { data: note, error } = await this.client.from("credit_notes").select(noteColumns)
      .eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle();
    if (error) throw new ApiError(502, "RETURN_READ_FAILED", "Return could not be loaded");
    if (!note) return null;
    const { data: items, error: itemError } = await this.client.from("credit_note_items").select(lineColumns)
      .eq("credit_note_id", id).order("id", { ascending: true });
    if (itemError) throw new ApiError(502, "RETURN_READ_FAILED", "Return lines could not be loaded");
    return { credit_note: note as CreditNoteSummary, items: (items ?? []) as CreditNoteLine[] };
  }
}
