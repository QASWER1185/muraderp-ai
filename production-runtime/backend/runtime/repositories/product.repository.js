import { getSupabaseAdminClient } from "../config/supabase.js";
export class SupabaseProductRepository {
    clientFactory;
    constructor(clientFactory = getSupabaseAdminClient) {
        this.clientFactory = clientFactory;
    }
    async create(input) {
        const client = this.clientFactory();
        const { data, error } = await client
            .from("products")
            .insert({
            name: input.name,
            sku: input.sku,
            category: input.category,
            unit: input.unit,
            purchase_price: input.purchase_price,
            sale_price: input.sale_price,
            brand_id: input.brand_id ?? null,
        })
            .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
            .single();
        if (error)
            throw error;
        return data;
    }
    async getById(id) {
        const client = this.clientFactory();
        const { data, error } = await client
            .from("products")
            .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
            .eq("id", id)
            .maybeSingle();
        if (error)
            throw error;
        return data ?? null;
    }
    async list(filter = {}) {
        const client = this.clientFactory();
        let query = client
            .from("products")
            .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
            .order("name", { ascending: true });
        if (filter.category)
            query = query.eq("category", filter.category);
        if (filter.brand_id != null)
            query = query.eq("brand_id", filter.brand_id);
        if (filter.search) {
            const term = filter.search.replace(/[%_]/g, "").trim();
            if (term)
                query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
        }
        const { data, error } = await query;
        if (error)
            throw error;
        return (data ?? []);
    }
    async update(id, input) {
        const client = this.clientFactory();
        const { data, error } = await client
            .from("products")
            .update({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.sku !== undefined ? { sku: input.sku } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.unit !== undefined ? { unit: input.unit } : {}),
            ...(input.purchase_price !== undefined ? { purchase_price: input.purchase_price } : {}),
            ...(input.sale_price !== undefined ? { sale_price: input.sale_price } : {}),
            ...(input.brand_id !== undefined ? { brand_id: input.brand_id } : {}),
        })
            .eq("id", id)
            .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
            .maybeSingle();
        if (error)
            throw error;
        return data ?? null;
    }
    async delete(id) {
        const client = this.clientFactory();
        const { data, error } = await client.from("products").delete().eq("id", id).select("id");
        if (error)
            throw error;
        return Array.isArray(data) && data.length > 0;
    }
}
//# sourceMappingURL=product.repository.js.map