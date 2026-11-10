import { ApiError } from "../errors/api-error.js";
import { getSupabaseAdminClient } from "../config/supabase.js";
/** History is a durable, live projection of ERP transactions, including non-Copilot sales.
 * No process cache, model-authored facts, or duplicate event counters can drift from accounting. */
export class CustomerMemoryStore {
    database;
    constructor(database = getSupabaseAdminClient) {
        this.database = database;
    }
    async history(scope, customerId, productId, invoiceId) {
        const rows = [];
        for (let offset = 0;; offset += 500) {
            let query = this.database().from("copilot_commercial_history").select("*")
                .eq("organization_id", scope.organizationId).eq("branch_id", scope.branchId).eq("customer_id", customerId);
            if (productId !== undefined)
                query = query.eq("product_id", productId).eq("document_type", "invoice");
            if (invoiceId !== undefined)
                query = query.eq("document_id", invoiceId);
            query = query.order("invoice_date", { ascending: false }).order("document_id", { ascending: false }).order("source_item_id", { ascending: false });
            const { data, error } = await query.range(offset, offset + 499);
            if (error)
                throw new ApiError(502, "CUSTOMER_MEMORY_UNAVAILABLE", "Customer sales history could not be verified.");
            rows.push(...(data ?? []));
            if ((data ?? []).length < 500)
                return rows;
        }
    }
    async recall(scope, customerId, customerName = String(customerId)) {
        const history = await this.history(scope, customerId);
        const transactions = new Map();
        const brands = new Map();
        for (const row of history) {
            const key = `${row.document_type}:${row.document_id}`;
            const transaction = transactions.get(key) ?? { date: row.invoice_date, volume: 0 };
            transaction.volume += Number(row.quantity) * Number(row.net_unit_price);
            transactions.set(key, transaction);
            if (row.brand_id != null && row.brand_name) {
                const brandKey = `${row.category}:${row.brand_id}`;
                const brand = brands.get(brandKey) ?? { category: row.category, brandId: row.brand_id, brandName: row.brand_name, documents: new Set() };
                brand.documents.add(key);
                brands.set(brandKey, brand);
            }
        }
        const preferredBrands = [...brands.values()].map(({ documents, ...brand }) => ({ ...brand, purchases: documents.size }))
            .sort((a, b) => b.purchases - a.purchases || a.brandId - b.brandId)
            .filter((brand, index, all) => all.findIndex(other => other.category === brand.category) === index);
        const dates = [...new Set([...transactions.values()].map(row => row.date))].sort();
        const last = history[0];
        return { customerId, preferredBrands, history, transactionCount: transactions.size,
            averageTransactionVolume: transactions.size ? [...transactions.values()].reduce((sum, row) => sum + row.volume, 0) / transactions.size : 0,
            averageOrderIntervalDays: dates.length < 2 ? null : (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86_400_000 / (dates.length - 1),
            context: `[Memory Context]: Customer: ${customerName} | Preferred: ${preferredBrands.map(row => row.category + ": " + row.brandName).join(", ") || "No history"}` +
                (last ? ` | Historical Discount: ${last.discount_percent}% on ${last.brand_name ?? last.product_name} / ${last.category} | Last Order: ${last.invoice_date} (${last.document_number})` : ""), };
    }
    async latestSale(scope, customerId, productId, invoiceId, invoiceItemId) {
        let history = await this.history(scope, customerId, productId, invoiceId);
        if (invoiceItemId != null)
            history = history.filter(row => row.source_item_id === invoiceItemId);
        const ids = [...new Set(history.map(row => row.document_id))], created = new Map();
        for (let offset = 0; offset < ids.length; offset += 100) {
            const { data, error } = await this.database().from('invoices').select('id,created_at').eq('organization_id', scope.organizationId).eq('branch_id', scope.branchId).eq('customer_id', customerId).in('id', ids.slice(offset, offset + 100)).order('created_at', { ascending: false });
            if (error)
                throw new ApiError(502, 'CUSTOMER_MEMORY_UNAVAILABLE', 'Historical invoice creation dates could not be read.');
            for (const invoice of data ?? [])
                created.set(invoice.id, Date.parse(invoice.created_at));
        }
        history = history.filter(row => created.has(row.document_id)).sort((a, b) => created.get(b.document_id) - created.get(a.document_id) || b.document_id - a.document_id || b.source_item_id - a.source_item_id);
        if (invoiceId && !invoiceItemId && history.filter(row => row.document_id === invoiceId).length > 1)
            throw new ApiError(422, 'RETURN_INVOICE_CHOICE_REQUIRED', 'This product occurs on multiple invoice lines; provide the exact invoiceItemId from the saved invoice.');
        const row = history[0];
        if (!row)
            throw new ApiError(422, "RETURN_HISTORY_REQUIRED", "No posted sale for this exact customer and product exists in this branch.");
        return row;
    }
    async assertFloor(scope, productId, listPrice, discount, unit, currency, inventoryCost, allowMissingPurchaseBaseline = false) {
        const { data, error } = await this.database().rpc("copilot_purchase_floor", {
            p_organization_id: scope.organizationId, p_product_id: productId, p_list_price: listPrice, p_unit: unit, p_currency: currency,
        });
        if (error)
            throw new ApiError(502, "PURCHASE_MEMORY_UNAVAILABLE", "Merchant cost floor could not be verified.");
        const stored = data == null ? undefined : Number(data);
        const costs = [stored, inventoryCost].filter((value) => value !== undefined && Number.isFinite(value) && value >= 0);
        if (!costs.length && !allowMissingPurchaseBaseline)
            throw new ApiError(422, "PURCHASE_BASELINE_REQUIRED", "A verified merchant purchase baseline is required before quoting this product.");
        // A saved V2 estimate draft may use an authoritative sale catalog price
        // before purchase cost is available. Preserve the floor check whenever a
        // purchase or inventory cost does exist; draft permission never implies a
        // final sale or financial posting.
        if (!costs.length)
            return;
        const net = listPrice * (1 - discount / 100);
        if (!Number.isFinite(net) || discount < 0 || discount > 100 || net + 0.0000001 < Math.max(...costs)) {
            throw new ApiError(422, "DISCOUNT_BELOW_COST", "The customer discount would reduce the sale price below the merchant cost floor.");
        }
    }
}
export function rememberedDiscount(profile, product, unit, currency, defaultDiscount = 0) {
    const compatible = profile.history.filter(row => row.unit === unit && row.currency_code === currency);
    return Number((compatible.find(row => row.product_id === product.id) ??
        compatible.find(row => row.brand_id != null && row.brand_id === product.brand_id && row.category === product.category))?.discount_percent ?? defaultDiscount);
}
export function returnMemoryMessage(customer, row, credited = false) {
    return `گاہک ${customer} کو یہ سامان ${row.invoice_date} کو انوائس ${row.document_number} کے تحت نیٹ ریٹ ${row.net_unit_price} پر بیچا گیا تھا۔ ` +
        (credited ? "واپسی عین اسی قیمت پر کریڈٹ کی گئی ہے۔" : "منظوری کے بعد واپسی عین اسی قیمت پر کریڈٹ کی جائے گی۔");
}
//# sourceMappingURL=customerMemoryStore.js.map