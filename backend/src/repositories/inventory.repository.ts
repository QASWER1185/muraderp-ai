import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "../config/supabase.js";
import type { Database } from "../types/database.types.js";
import type { InventoryBalance, InventoryListFilter, InventoryMovement, MovementListFilter } from "../types/inventory.types.js";

type InventoryClient = SupabaseClient<Database>;

export interface InventoryRepository {
  listBalances(organizationId: string, filter?: InventoryListFilter): Promise<InventoryBalance[]>;
  getBalance(organizationId: string, productId: number, warehouseId: number): Promise<InventoryBalance | null>;
  listMovements(organizationId: string, branchId: string, filter?: MovementListFilter): Promise<InventoryMovement[]>;
}

export class SupabaseInventoryRepository implements InventoryRepository {
  constructor(private readonly clientFactory: () => InventoryClient = getSupabaseAdminClient) {}

  async listBalances(organizationId: string, filter: InventoryListFilter = {}): Promise<InventoryBalance[]> {
    const client = this.clientFactory();
    let query = client
      .from("inventory")
      .select("id, product_id, warehouse_id, quantity, created_at, updated_at")
      .eq("organization_id", organizationId)
      .order("product_id", { ascending: true });

    if (filter.product_id !== undefined) query = query.eq("product_id", filter.product_id);
    if (filter.warehouse_id !== undefined) query = query.eq("warehouse_id", filter.warehouse_id);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as InventoryBalance[];
  }

  async getBalance(organizationId: string, productId: number, warehouseId: number): Promise<InventoryBalance | null> {
    const client = this.clientFactory();
    const { data, error } = await client
      .from("inventory")
      .select("id, product_id, warehouse_id, quantity, created_at, updated_at")
      .eq("organization_id", organizationId)
      .eq("product_id", productId)
      .eq("warehouse_id", warehouseId)
      .maybeSingle();

    if (error) throw error;
    return (data as InventoryBalance | null) ?? null;
  }

  async listMovements(organizationId: string, branchId: string, filter: MovementListFilter = {}): Promise<InventoryMovement[]> {
    const client = this.clientFactory();
    let query = client
      .from("stock_movements")
      .select("id, product_id, warehouse_id, movement_type, quantity, reference_type, reference_id, unit_cost, notes, created_at")
      .eq("organization_id", organizationId)
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false });

    if (filter.product_id !== undefined) query = query.eq("product_id", filter.product_id);
    if (filter.warehouse_id !== undefined) query = query.eq("warehouse_id", filter.warehouse_id);
    if (filter.movement_type) query = query.eq("movement_type", filter.movement_type);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as InventoryMovement[];
  }
}
