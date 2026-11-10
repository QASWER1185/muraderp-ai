import { getSupabaseAdminClient } from "../config/supabase.js";
export class SupabasePricingRepository {
    clientFactory;
    constructor(clientFactory = getSupabaseAdminClient) {
        this.clientFactory = clientFactory;
    }
    async findBestRateListItem(context) {
        const client = this.clientFactory();
        const query = client
            .from("rate_list_items")
            .select(`
        id,
        product_id,
        minimum_quantity,
        unit_price,
        unit,
        rate_list_versions!inner (
          id,
          effective_from,
          effective_to,
          status,
          rate_lists!inner (
            id,
            price_type,
            scope_type,
            vendor_id,
            customer_id,
            currency_code,
            is_active
          )
        )
      `)
            .eq("rate_list_versions.rate_lists.organization_id", context.organization_id)
            .eq("product_id", context.product_id)
            .lte("minimum_quantity", context.quantity)
            .eq("rate_list_versions.status", "ACTIVE")
            .lte("rate_list_versions.effective_from", context.as_of)
            .eq("rate_list_versions.rate_lists.price_type", context.price_type)
            .eq("rate_list_versions.rate_lists.is_active", true)
            .or(`effective_to.is.null,effective_to.gt.${context.as_of}`, { referencedTable: "rate_list_versions" });
        if (context.rate_list_id != null) {
            query.eq("rate_list_versions.rate_lists.id", context.rate_list_id);
        }
        const { data, error } = await query
            .order("minimum_quantity", { ascending: false })
            .limit(1000);
        if (error)
            throw error;
        if ((data?.length ?? 0) >= 1000)
            throw new Error("Ambiguous pricing: candidate limit reached; select an explicit rate list");
        const candidates = (data ?? []);
        const applicable = candidates.filter((candidate) => {
            const list = candidate.rate_list_versions.rate_lists;
            if (context.rate_list_id != null)
                return list.id === context.rate_list_id;
            if (list.scope_type === "CUSTOMER")
                return list.customer_id === context.customer_id;
            if (list.scope_type === "VENDOR")
                return list.vendor_id === context.vendor_id;
            return true;
        });
        // Match the authoritative rate-list repository: dates and quantity tiers
        // select within a list, never silently choose between competing lists.
        if (context.rate_list_id == null && applicable.length) {
            const priority = { CUSTOMER: 3, VENDOR: 2, GLOBAL: 1 };
            const winning = Math.max(...applicable.map((item) => priority[item.rate_list_versions.rate_lists.scope_type]));
            const lists = new Set(applicable.filter((item) => priority[item.rate_list_versions.rate_lists.scope_type] === winning).map((item) => item.rate_list_versions.rate_lists.id));
            if (lists.size > 1)
                throw new Error("Ambiguous pricing: multiple active rate lists match the winning scope");
        }
        applicable.sort((a, b) => {
            const scopeRank = (scope) => scope === "CUSTOMER" ? 3 : scope === "VENDOR" ? 2 : 1;
            const scopeDifference = scopeRank(b.rate_list_versions.rate_lists.scope_type) - scopeRank(a.rate_list_versions.rate_lists.scope_type);
            if (scopeDifference !== 0)
                return scopeDifference;
            const effectiveDifference = Date.parse(b.rate_list_versions.effective_from) - Date.parse(a.rate_list_versions.effective_from);
            if (effectiveDifference !== 0)
                return effectiveDifference;
            return b.minimum_quantity - a.minimum_quantity;
        });
        const winner = applicable[0];
        if (!winner)
            return null;
        const list = winner.rate_list_versions.rate_lists;
        return {
            rate_list_id: list.id,
            rate_list_version_id: winner.rate_list_versions.id,
            rate_list_item_id: winner.id,
            product_id: winner.product_id,
            unit_price: winner.unit_price,
            unit: winner.unit,
            currency_code: list.currency_code,
            minimum_quantity: winner.minimum_quantity,
            scope_type: list.scope_type,
            effective_from: winner.rate_list_versions.effective_from,
        };
    }
}
//# sourceMappingURL=pricing.repository.js.map