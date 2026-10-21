import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { Database } from "../types/database.types.js";
import type { ProductDefinition, ProductListFilter, ProductRecord } from "../types/product.types.js";

type ProductClient = SupabaseClient<Database>;

export interface ProductRepository {
  create(input: ProductDefinition): Promise<ProductRecord>;
  getById(id: number): Promise<ProductRecord | null>;
  list(filter?: ProductListFilter): Promise<ProductRecord[]>;
  update(id: number, input: Partial<ProductDefinition>): Promise<ProductRecord | null>;
  delete(id: number): Promise<boolean>;
}

export class SupabaseProductRepository implements ProductRepository {
  constructor(private readonly clientFactory: () => ProductClient = getSupabaseAdminClient) {}

  async create(input: ProductDefinition): Promise<ProductRecord> {
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

    if (error) throw error;
    return data as ProductRecord;
  }

  async getById(id: number): Promise<ProductRecord | null> {
    const client = this.clientFactory();
    const { data, error } = await client
      .from("products")
      .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return (data as ProductRecord | null) ?? null;
  }

  async list(filter: ProductListFilter = {}): Promise<ProductRecord[]> {
    const client = this.clientFactory();
    let query = client
      .from("products")
      .select("id, name, sku, category, unit, purchase_price, sale_price, brand_id, created_at, updated_at")
      .order("name", { ascending: true });

    if (filter.category) query = query.eq("category", filter.category);
    if (filter.brand_id != null) query = query.eq("brand_id", filter.brand_id);
    if (filter.search) {
      const term = filter.search.replace(/[%_]/g, "").trim();
      if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as ProductRecord[];
  }

  async update(id: number, input: Partial<ProductDefinition>): Promise<ProductRecord | null> {
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

    if (error) throw error;
    return (data as ProductRecord | null) ?? null;
  }

  async delete(id: number): Promise<boolean> {
    const client = this.clientFactory();
    const { data, error } = await client.from("products").delete().eq("id", id).select("id");
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
}
