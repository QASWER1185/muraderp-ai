import { getSupabaseServiceRoleClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
const noteColumns = "id, credit_note_number, invoice_id, customer_id, credit_date, currency_code, status, subtotal, grand_total, reason, notes";
const lineColumns = "id, invoice_item_id, product_id, warehouse_id, quantity, unit, unit_price, line_total";
export class SupabaseSalesReturnBrowserRepository {
    clientFactory;
    constructor(clientFactory = getSupabaseServiceRoleClient) {
        this.clientFactory = clientFactory;
    }
    get client() {
        // Generated database types lag the scoped credit-note columns in the active migration.
        return this.clientFactory();
    }
    async list(organizationId, branchId, limit, cursor, search) {
        let query = this.client.from("credit_notes").select(noteColumns)
            .eq("organization_id", organizationId).eq("branch_id", branchId)
            .order("id", { ascending: false }).limit(limit + 1);
        if (cursor !== undefined)
            query = query.lt("id", cursor);
        if (search) {
            const invoiceId = /^\d+$/.test(search) ? Number(search) : NaN;
            query = Number.isSafeInteger(invoiceId) && invoiceId > 0
                ? query.eq("invoice_id", invoiceId)
                : query.ilike("credit_note_number", `%${search}%`);
        }
        const { data, error } = await query;
        if (error)
            throw new ApiError(502, "RETURN_READ_FAILED", "Returns could not be loaded");
        const rows = (data ?? []);
        return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1].id : null };
    }
    async getById(organizationId, branchId, id) {
        const { data: note, error } = await this.client.from("credit_notes").select(noteColumns)
            .eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle();
        if (error)
            throw new ApiError(502, "RETURN_READ_FAILED", "Return could not be loaded");
        if (!note)
            return null;
        const { data: items, error: itemError } = await this.client.from("credit_note_items").select(lineColumns)
            .eq("credit_note_id", id).order("id", { ascending: true });
        if (itemError)
            throw new ApiError(502, "RETURN_READ_FAILED", "Return lines could not be loaded");
        return { credit_note: note, items: (items ?? []) };
    }
}
//# sourceMappingURL=sales-return-browser.repository.js.map