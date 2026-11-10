import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
function pageResult(rows, requestedLimit) {
    const hasMore = rows.length > requestedLimit;
    const data = rows.slice(0, requestedLimit);
    return {
        data,
        next_cursor: hasMore && data.length > 0 ? data[data.length - 1].id : null,
    };
}
function databaseError(error, operation) {
    switch (error.code) {
        case "P0001":
            return new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "The Idempotency-Key was already used for a different purchase request");
        case "P0002":
            return new ApiError(409, "DUPLICATE_INVOICE", "The vendor invoice number already exists");
        case "P0003":
            return new ApiError(409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", "The Idempotency-Key is currently being processed; retry shortly");
        case "23503":
            return new ApiError(409, "REFERENCE_CONFLICT", "A related record prevents this operation");
        case "23505":
            return new ApiError(409, "DUPLICATE_RECORD", "A record with the same unique value exists");
        case "23514":
        case "22023":
            return new ApiError(400, "BUSINESS_RULE_VIOLATION", "The request violates a business rule");
        case "42501":
            return new ApiError(403, "AUTHORIZATION_DENIED", error.message || "The purchase is not authorized for this organization or branch");
        default:
            return new ApiError(502, "DATABASE_OPERATION_FAILED", `${operation} could not be completed`);
    }
}
export class SupabaseErpService {
    clientFactory;
    constructor(clientFactory = getSupabaseAdminClient) {
        this.clientFactory = clientFactory;
    }
    get client() {
        return this.clientFactory();
    }
    async listBrands(page, organizationId) {
        let query = this.client.from("brands").select("*").eq("organization_id", organizationId).order("id").limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Brands");
        return pageResult(data, page.limit);
    }
    async getBrand(id, organizationId) {
        const { data, error } = await this.client.from("brands").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
        if (error)
            throw databaseError(error, "Brand");
        return data;
    }
    async createBrand(input, organizationId) {
        const { data, error } = await this.client.from("brands").insert({ ...input, organization_id: organizationId }).select("*").single();
        if (error)
            throw databaseError(error, "Brand creation");
        return data;
    }
    async updateBrand(id, input, organizationId) {
        const { data, error } = await this.client
            .from("brands")
            .update(input)
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("*")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Brand update");
        return data;
    }
    async deleteBrand(id, organizationId) {
        const { data, error } = await this.client.from("brands").delete().eq("organization_id", organizationId).eq("id", id).select("id").maybeSingle();
        if (error)
            throw databaseError(error, "Brand deletion");
        return data !== null;
    }
    async listCustomers(page, organizationId) {
        let query = this.client.from("customers").select("*").eq("organization_id", organizationId).order("id").limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Customers");
        return pageResult(data, page.limit);
    }
    async getCustomer(id, organizationId) {
        const { data, error } = await this.client.from("customers").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
        if (error)
            throw databaseError(error, "Customer");
        return data;
    }
    async createCustomer(input, organizationId) {
        const { data, error } = await this.client.from("customers").insert({ ...input, phone: input.phone?.trim() || null, address: input.address ?? null, organization_id: organizationId }).select("*").single();
        if (error)
            throw databaseError(error, "Customer creation");
        return data;
    }
    async updateCustomer(id, input, organizationId) {
        const { data, error } = await this.client
            .from("customers")
            .update({ ...input, ...(Object.hasOwn(input, "phone") ? { phone: input.phone?.trim() || null } : {}) })
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("*")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Customer update");
        return data;
    }
    async deleteCustomer(id, organizationId) {
        const { data, error } = await this.client.from("customers").delete().eq("organization_id", organizationId).eq("id", id).select("id").maybeSingle();
        if (error)
            throw databaseError(error, "Customer deletion");
        return data !== null;
    }
    async listVendors(page, organizationId) {
        let query = this.client.from("vendors").select("*").eq("organization_id", organizationId).order("id").limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Vendors");
        return pageResult(data, page.limit);
    }
    async getVendor(id, organizationId) {
        const { data, error } = await this.client.from("vendors").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
        if (error)
            throw databaseError(error, "Vendor");
        return data;
    }
    async createVendor(input, organizationId) {
        const { data, error } = await this.client.from("vendors").insert({ ...input, organization_id: organizationId }).select("*").single();
        if (error)
            throw databaseError(error, "Vendor creation");
        return data;
    }
    async updateVendor(id, input, organizationId) {
        const { data, error } = await this.client
            .from("vendors")
            .update(input)
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("*")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Vendor update");
        return data;
    }
    async deleteVendor(id, organizationId) {
        const { data, error } = await this.client.from("vendors").delete().eq("organization_id", organizationId).eq("id", id).select("id").maybeSingle();
        if (error)
            throw databaseError(error, "Vendor deletion");
        return data !== null;
    }
    async listProducts(page, organizationId) {
        let query = this.client
            .from("products")
            .select("*")
            .eq("organization_id", organizationId)
            .order("id")
            .limit(page.limit + 1);
        const search = page.search?.normalize("NFKC").trim().replace(/[^\p{L}\p{N}\s._/-]/gu, " ").replace(/\s+/g, " ").trim();
        if (search)
            query = query.or(`name.ilike."%${search}%",sku.ilike."%${search}%"`);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Products");
        return pageResult(data, page.limit);
    }
    async getProduct(id, organizationId) {
        const { data, error } = await this.client
            .from("products")
            .select("*")
            .eq("organization_id", organizationId)
            .eq("id", id)
            .maybeSingle();
        if (error)
            throw databaseError(error, "Product");
        return data;
    }
    async createProduct(input, organizationId) {
        const product = {
            organization_id: organizationId,
            name: input.name,
            sku: input.sku,
            category: input.category,
            unit: input.unit,
            purchase_price: input.purchase_price,
            sale_price: input.sale_price,
            ...(input.brand_id === undefined ? {} : { brand_id: input.brand_id }),
        };
        const { data, error } = await this.client.from("products").insert(product).select("*").single();
        if (error)
            throw databaseError(error, "Product creation");
        return data;
    }
    async updateProduct(id, input, organizationId) {
        const { data, error } = await this.client
            .from("products")
            .update(input)
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("*")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Product update");
        return data;
    }
    async deleteProduct(id, organizationId) {
        const { data, error } = await this.client
            .from("products")
            .delete()
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("id")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Product deletion");
        return data !== null;
    }
    async listWarehouses(page, organizationId) {
        let query = this.client.from("warehouses").select("*").eq("organization_id", organizationId).order("id").limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Warehouses");
        return pageResult(data, page.limit);
    }
    async getWarehouse(id, organizationId) {
        const { data, error } = await this.client.from("warehouses").select("*").eq("organization_id", organizationId).eq("id", id).maybeSingle();
        if (error)
            throw databaseError(error, "Warehouse");
        return data;
    }
    async createWarehouse(input, organizationId) {
        const warehouse = {
            organization_id: organizationId,
            name: input.name,
            ...(input.location === undefined ? {} : { location: input.location }),
        };
        const { data, error } = await this.client
            .from("warehouses")
            .insert(warehouse)
            .select("*")
            .single();
        if (error)
            throw databaseError(error, "Warehouse creation");
        return data;
    }
    async updateWarehouse(id, input, organizationId) {
        const { data, error } = await this.client
            .from("warehouses")
            .update(input)
            .eq("organization_id", organizationId)
            .eq("id", id)
            .select("*")
            .maybeSingle();
        if (error)
            throw databaseError(error, "Warehouse update");
        return data;
    }
    async deleteWarehouse(id, organizationId) {
        const { data, error } = await this.client.from("warehouses").delete().eq("organization_id", organizationId).eq("id", id).select("id").maybeSingle();
        if (error)
            throw databaseError(error, "Warehouse deletion");
        return data !== null;
    }
    async listInventory(page, organizationId) {
        let query = this.client.from("inventory").select("*").eq("organization_id", organizationId).order("id").limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.gt("id", page.cursor);
        if (page.product_id !== undefined)
            query = query.eq("product_id", page.product_id);
        if (page.warehouse_id !== undefined)
            query = query.eq("warehouse_id", page.warehouse_id);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Inventory");
        return pageResult(data, page.limit);
    }
    async listStockMovements(page, organizationId, branchId) {
        let query = this.client
            .from("stock_movements")
            .select("*")
            .eq("organization_id", organizationId)
            .eq("branch_id", branchId)
            .order("id", { ascending: false })
            .limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.lt("id", page.cursor);
        if (page.product_id !== undefined)
            query = query.eq("product_id", page.product_id);
        if (page.warehouse_id !== undefined)
            query = query.eq("warehouse_id", page.warehouse_id);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Stock movements");
        return pageResult(data, page.limit);
    }
    async listPurchases(page, organizationId, branchId) {
        let query = this.client
            .from("purchases")
            .select("*")
            .eq("organization_id", organizationId)
            .eq("branch_id", branchId)
            .order("id", { ascending: false })
            .limit(page.limit + 1);
        if (page.cursor !== undefined)
            query = query.lt("id", page.cursor);
        const { data, error } = await query;
        if (error)
            throw databaseError(error, "Purchases");
        return pageResult(data, page.limit);
    }
    async getPurchase(id, organizationId, branchId) {
        const [purchaseResult, itemsResult] = await Promise.all([
            this.client.from("purchases").select("*").eq("organization_id", organizationId).eq("branch_id", branchId).eq("id", id).maybeSingle(),
            this.client.from("purchase_items").select("*").eq("organization_id", organizationId).eq("branch_id", branchId).eq("purchase_id", id).order("id"),
        ]);
        if (purchaseResult.error)
            throw databaseError(purchaseResult.error, "Purchase");
        if (itemsResult.error)
            throw databaseError(itemsResult.error, "Purchase items");
        if (!purchaseResult.data)
            return null;
        return { purchase: purchaseResult.data, items: itemsResult.data };
    }
    async recordPurchase(input, idempotency) {
        const { data, error } = await this.client.rpc("record_purchase", {
            p_vendor_id: input.vendor_id,
            p_warehouse_id: input.warehouse_id,
            p_items: input.items,
            p_organization_id: idempotency.organizationId,
            p_branch_id: idempotency.branchId,
            p_actor_user_id: idempotency.actorUserId,
            p_service_principal: idempotency.servicePrincipalId,
            p_operation_scope: idempotency.operation,
            p_idempotency_key: idempotency.idempotencyKey,
            p_request_fingerprint: idempotency.requestFingerprint,
            ...(input.purchase_date === undefined ? {} : { p_purchase_date: input.purchase_date }),
            ...(input.invoice_number === undefined ? {} : { p_invoice_number: input.invoice_number }),
            ...(input.discount === undefined ? {} : { p_discount: input.discount }),
            ...(input.tax === undefined ? {} : { p_tax: input.tax }),
            ...(input.notes === undefined ? {} : { p_notes: input.notes }),
        });
        if (error)
            throw databaseError(error, "Purchase creation");
        const result = data;
        const responseBody = result.response_body;
        if (!responseBody.data?.purchase ||
            !Array.isArray(responseBody.data.items) ||
            result.response_status !== 201) {
            throw new ApiError(502, "DATABASE_OPERATION_FAILED", "Purchase response could not be reconstructed");
        }
        return {
            purchase: responseBody.data.purchase,
            items: responseBody.data.items,
        };
    }
}
//# sourceMappingURL=erp.service.js.map