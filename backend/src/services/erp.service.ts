import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import { ApiError } from "../errors/api-error.js";
import type { Database, Json } from "../types/database.types.js";

type Tables = Database["public"]["Tables"];

export type Brand = Tables["brands"]["Row"];
export type Customer = Tables["customers"]["Row"];
export type Inventory = Tables["inventory"]["Row"];
export type Product = Tables["products"]["Row"];
export type Purchase = Tables["purchases"]["Row"];
export type PurchaseItem = Tables["purchase_items"]["Row"];
export type StockMovement = Tables["stock_movements"]["Row"];
export type Vendor = Tables["vendors"]["Row"];
export type Warehouse = Tables["warehouses"]["Row"];

export type BrandInput = Pick<Tables["brands"]["Insert"], "name">;
export type CustomerInput = Pick<Tables["customers"]["Insert"], "name" | "phone" | "city">;
export type ProductInput = Pick<
  Tables["products"]["Insert"],
  "name" | "sku" | "category" | "unit" | "purchase_price" | "sale_price"
> & { brand_id?: number | null | undefined };
export type VendorInput = Pick<Tables["vendors"]["Insert"], "name" | "phone" | "city">;
export type WarehouseInput = Pick<Tables["warehouses"]["Insert"], "name"> & {
  location?: string | null | undefined;
};

export type Patch<T> = { [Key in keyof T]?: T[Key] | undefined };

export interface PageRequest {
  cursor?: number | undefined;
  limit: number;
}

export interface PageResult<T extends { id: number }> {
  data: T[];
  next_cursor: number | null;
}

export interface InventoryRequest extends PageRequest {
  product_id?: number | undefined;
  warehouse_id?: number | undefined;
}

export interface PurchaseLineInput {
  product_id: number;
  quantity: number;
  unit_cost: number;
}

export interface RecordPurchaseInput {
  vendor_id: number;
  warehouse_id: number;
  items: PurchaseLineInput[];
  purchase_date?: string | undefined;
  invoice_number?: string | undefined;
  discount?: number | undefined;
  tax?: number | undefined;
  notes?: string | undefined;
}

export interface PurchaseDetail {
  purchase: Purchase;
  items: PurchaseItem[];
}

export interface ErpService {
  listBrands(page: PageRequest): Promise<PageResult<Brand>>;
  getBrand(id: number): Promise<Brand | null>;
  createBrand(input: BrandInput): Promise<Brand>;
  updateBrand(id: number, input: Patch<BrandInput>): Promise<Brand | null>;
  deleteBrand(id: number): Promise<boolean>;

  listCustomers(page: PageRequest): Promise<PageResult<Customer>>;
  getCustomer(id: number): Promise<Customer | null>;
  createCustomer(input: CustomerInput): Promise<Customer>;
  updateCustomer(id: number, input: Patch<CustomerInput>): Promise<Customer | null>;
  deleteCustomer(id: number): Promise<boolean>;

  listVendors(page: PageRequest): Promise<PageResult<Vendor>>;
  getVendor(id: number): Promise<Vendor | null>;
  createVendor(input: VendorInput): Promise<Vendor>;
  updateVendor(id: number, input: Patch<VendorInput>): Promise<Vendor | null>;
  deleteVendor(id: number): Promise<boolean>;

  listProducts(page: PageRequest): Promise<PageResult<Product>>;
  getProduct(id: number): Promise<Product | null>;
  createProduct(input: ProductInput): Promise<Product>;
  updateProduct(id: number, input: Patch<ProductInput>): Promise<Product | null>;
  deleteProduct(id: number): Promise<boolean>;

  listWarehouses(page: PageRequest): Promise<PageResult<Warehouse>>;
  getWarehouse(id: number): Promise<Warehouse | null>;
  createWarehouse(input: WarehouseInput): Promise<Warehouse>;
  updateWarehouse(id: number, input: Patch<WarehouseInput>): Promise<Warehouse | null>;
  deleteWarehouse(id: number): Promise<boolean>;

  listInventory(page: InventoryRequest): Promise<PageResult<Inventory>>;
  listStockMovements(page: InventoryRequest): Promise<PageResult<StockMovement>>;
  listPurchases(page: PageRequest): Promise<PageResult<Purchase>>;
  getPurchase(id: number): Promise<PurchaseDetail | null>;
  recordPurchase(input: RecordPurchaseInput): Promise<PurchaseDetail>;
}

function pageResult<T extends { id: number }>(rows: T[], requestedLimit: number): PageResult<T> {
  const hasMore = rows.length > requestedLimit;
  const data = rows.slice(0, requestedLimit);

  return {
    data,
    next_cursor: hasMore && data.length > 0 ? data[data.length - 1]!.id : null,
  };
}

function databaseError(error: PostgrestError, operation: string): ApiError {
  switch (error.code) {
    case "23503":
      return new ApiError(409, "REFERENCE_CONFLICT", "A related record prevents this operation");
    case "23505":
      return new ApiError(409, "DUPLICATE_RECORD", "A record with the same unique value exists");
    case "23514":
    case "22023":
      return new ApiError(400, "BUSINESS_RULE_VIOLATION", "The request violates a business rule");
    case "42501":
      return new ApiError(503, "DATABASE_ACCESS_DENIED", "Database access is not configured correctly");
    default:
      return new ApiError(502, "DATABASE_OPERATION_FAILED", `${operation} could not be completed`);
  }
}

export class SupabaseErpService implements ErpService {
  constructor(
    private readonly clientFactory: () => SupabaseClient<Database> = getSupabaseAdminClient,
  ) {}

  private get client(): SupabaseClient<Database> {
    return this.clientFactory();
  }

  async listBrands(page: PageRequest): Promise<PageResult<Brand>> {
    let query = this.client.from("brands").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Brands");
    return pageResult(data, page.limit);
  }

  async getBrand(id: number): Promise<Brand | null> {
    const { data, error } = await this.client.from("brands").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseError(error, "Brand");
    return data;
  }

  async createBrand(input: BrandInput): Promise<Brand> {
    const { data, error } = await this.client.from("brands").insert(input).select("*").single();
    if (error) throw databaseError(error, "Brand creation");
    return data;
  }

  async updateBrand(id: number, input: Patch<BrandInput>): Promise<Brand | null> {
    const { data, error } = await this.client
      .from("brands")
      .update(input as Tables["brands"]["Update"])
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError(error, "Brand update");
    return data;
  }

  async deleteBrand(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("brands").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw databaseError(error, "Brand deletion");
    return data !== null;
  }

  async listCustomers(page: PageRequest): Promise<PageResult<Customer>> {
    let query = this.client.from("customers").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Customers");
    return pageResult(data, page.limit);
  }

  async getCustomer(id: number): Promise<Customer | null> {
    const { data, error } = await this.client.from("customers").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseError(error, "Customer");
    return data;
  }

  async createCustomer(input: CustomerInput): Promise<Customer> {
    const { data, error } = await this.client.from("customers").insert(input).select("*").single();
    if (error) throw databaseError(error, "Customer creation");
    return data;
  }

  async updateCustomer(id: number, input: Patch<CustomerInput>): Promise<Customer | null> {
    const { data, error } = await this.client
      .from("customers")
      .update(input as Tables["customers"]["Update"])
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError(error, "Customer update");
    return data;
  }

  async deleteCustomer(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("customers").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw databaseError(error, "Customer deletion");
    return data !== null;
  }

  async listVendors(page: PageRequest): Promise<PageResult<Vendor>> {
    let query = this.client.from("vendors").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Vendors");
    return pageResult(data, page.limit);
  }

  async getVendor(id: number): Promise<Vendor | null> {
    const { data, error } = await this.client.from("vendors").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseError(error, "Vendor");
    return data;
  }

  async createVendor(input: VendorInput): Promise<Vendor> {
    const { data, error } = await this.client.from("vendors").insert(input).select("*").single();
    if (error) throw databaseError(error, "Vendor creation");
    return data;
  }

  async updateVendor(id: number, input: Patch<VendorInput>): Promise<Vendor | null> {
    const { data, error } = await this.client
      .from("vendors")
      .update(input as Tables["vendors"]["Update"])
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError(error, "Vendor update");
    return data;
  }

  async deleteVendor(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("vendors").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw databaseError(error, "Vendor deletion");
    return data !== null;
  }

  async listProducts(page: PageRequest): Promise<PageResult<Product>> {
    let query = this.client.from("products").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Products");
    return pageResult(data, page.limit);
  }

  async getProduct(id: number): Promise<Product | null> {
    const { data, error } = await this.client.from("products").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseError(error, "Product");
    return data;
  }

  async createProduct(input: ProductInput): Promise<Product> {
    const product: Tables["products"]["Insert"] = {
      name: input.name,
      sku: input.sku,
      category: input.category,
      unit: input.unit,
      purchase_price: input.purchase_price,
      sale_price: input.sale_price,
      ...(input.brand_id === undefined ? {} : { brand_id: input.brand_id }),
    };
    const { data, error } = await this.client.from("products").insert(product).select("*").single();
    if (error) throw databaseError(error, "Product creation");
    return data;
  }

  async updateProduct(id: number, input: Patch<ProductInput>): Promise<Product | null> {
    const { data, error } = await this.client
      .from("products")
      .update(input as Tables["products"]["Update"])
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError(error, "Product update");
    return data;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("products").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw databaseError(error, "Product deletion");
    return data !== null;
  }

  async listWarehouses(page: PageRequest): Promise<PageResult<Warehouse>> {
    let query = this.client.from("warehouses").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Warehouses");
    return pageResult(data, page.limit);
  }

  async getWarehouse(id: number): Promise<Warehouse | null> {
    const { data, error } = await this.client.from("warehouses").select("*").eq("id", id).maybeSingle();
    if (error) throw databaseError(error, "Warehouse");
    return data;
  }

  async createWarehouse(input: WarehouseInput): Promise<Warehouse> {
    const warehouse: Tables["warehouses"]["Insert"] = {
      name: input.name,
      ...(input.location === undefined ? {} : { location: input.location }),
    };
    const { data, error } = await this.client
      .from("warehouses")
      .insert(warehouse)
      .select("*")
      .single();
    if (error) throw databaseError(error, "Warehouse creation");
    return data;
  }

  async updateWarehouse(id: number, input: Patch<WarehouseInput>): Promise<Warehouse | null> {
    const { data, error } = await this.client
      .from("warehouses")
      .update(input as Tables["warehouses"]["Update"])
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw databaseError(error, "Warehouse update");
    return data;
  }

  async deleteWarehouse(id: number): Promise<boolean> {
    const { data, error } = await this.client.from("warehouses").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw databaseError(error, "Warehouse deletion");
    return data !== null;
  }

  async listInventory(page: InventoryRequest): Promise<PageResult<Inventory>> {
    let query = this.client.from("inventory").select("*").order("id").limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.gt("id", page.cursor);
    if (page.product_id !== undefined) query = query.eq("product_id", page.product_id);
    if (page.warehouse_id !== undefined) query = query.eq("warehouse_id", page.warehouse_id);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Inventory");
    return pageResult(data, page.limit);
  }

  async listStockMovements(page: InventoryRequest): Promise<PageResult<StockMovement>> {
    let query = this.client
      .from("stock_movements")
      .select("*")
      .order("id", { ascending: false })
      .limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.lt("id", page.cursor);
    if (page.product_id !== undefined) query = query.eq("product_id", page.product_id);
    if (page.warehouse_id !== undefined) query = query.eq("warehouse_id", page.warehouse_id);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Stock movements");
    return pageResult(data, page.limit);
  }

  async listPurchases(page: PageRequest): Promise<PageResult<Purchase>> {
    let query = this.client
      .from("purchases")
      .select("*")
      .order("id", { ascending: false })
      .limit(page.limit + 1);
    if (page.cursor !== undefined) query = query.lt("id", page.cursor);
    const { data, error } = await query;
    if (error) throw databaseError(error, "Purchases");
    return pageResult(data, page.limit);
  }

  async getPurchase(id: number): Promise<PurchaseDetail | null> {
    const [purchaseResult, itemsResult] = await Promise.all([
      this.client.from("purchases").select("*").eq("id", id).maybeSingle(),
      this.client.from("purchase_items").select("*").eq("purchase_id", id).order("id"),
    ]);

    if (purchaseResult.error) throw databaseError(purchaseResult.error, "Purchase");
    if (itemsResult.error) throw databaseError(itemsResult.error, "Purchase items");
    if (!purchaseResult.data) return null;

    return { purchase: purchaseResult.data, items: itemsResult.data };
  }

  async recordPurchase(input: RecordPurchaseInput): Promise<PurchaseDetail> {
    const { data: purchaseId, error } = await this.client.rpc("record_purchase", {
      p_vendor_id: input.vendor_id,
      p_warehouse_id: input.warehouse_id,
      p_items: input.items as unknown as Json,
      ...(input.purchase_date === undefined ? {} : { p_purchase_date: input.purchase_date }),
      ...(input.invoice_number === undefined ? {} : { p_invoice_number: input.invoice_number }),
      ...(input.discount === undefined ? {} : { p_discount: input.discount }),
      ...(input.tax === undefined ? {} : { p_tax: input.tax }),
      ...(input.notes === undefined ? {} : { p_notes: input.notes }),
    });

    if (error) throw databaseError(error, "Purchase creation");

    const purchase = await this.getPurchase(purchaseId);
    if (!purchase) {
      throw new ApiError(502, "DATABASE_OPERATION_FAILED", "Created purchase could not be read back");
    }

    return purchase;
  }
}
