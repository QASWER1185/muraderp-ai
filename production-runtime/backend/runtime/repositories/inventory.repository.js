import { getSupabaseAdminClient } from "../config/supabase.js";
export class SupabaseInventoryRepository {
    clientFactory;
    constructor(clientFactory = getSupabaseAdminClient) {
        this.clientFactory = clientFactory;
    }
    async listBalances(organizationId, filter = {}) {
        const client = this.clientFactory();
        let query = client
            .from("inventory")
            .select("id, product_id, warehouse_id, quantity, created_at, updated_at")
            .eq("organization_id", organizationId)
            .order("product_id", { ascending: true });
        if (filter.product_id !== undefined)
            query = query.eq("product_id", filter.product_id);
        if (filter.warehouse_id !== undefined)
            query = query.eq("warehouse_id", filter.warehouse_id);
        const { data, error } = await query;
        if (error)
            throw error;
        return (data ?? []);
    }
    async getBalance(organizationId, productId, warehouseId) {
        const client = this.clientFactory();
        const { data, error } = await client
            .from("inventory")
            .select("id, product_id, warehouse_id, quantity, created_at, updated_at")
            .eq("organization_id", organizationId)
            .eq("product_id", productId)
            .eq("warehouse_id", warehouseId)
            .maybeSingle();
        if (error)
            throw error;
        return data ?? null;
    }
    async listMovements(organizationId, branchId, filter = {}) {
        const client = this.clientFactory();
        let query = client
            .from("stock_movements")
            .select("id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, unit_cost, notes, created_at")
            .eq("organization_id", organizationId)
            .eq("branch_id", branchId)
            .order("created_at", { ascending: false });
        if (filter.product_id !== undefined)
            query = query.eq("product_id", filter.product_id);
        if (filter.warehouse_id !== undefined)
            query = query.eq("warehouse_id", filter.warehouse_id);
        if (filter.movement_type)
            query = query.eq("movement_type", filter.movement_type);
        const { data, error } = await query;
        if (error)
            throw error;
        return (data ?? []);
    }
}
//# sourceMappingURL=inventory.repository.js.map