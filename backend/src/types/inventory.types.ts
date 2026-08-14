export interface InventoryBalance {
  id: number;
  product_id: number;
  warehouse_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  warehouse_id: number;
  movement_type: string;
  quantity: number;
  reference_type: string | null;
  reference_id: number | null;
  unit_cost: number | null;
  notes: string | null;
  created_at: string;
}

export interface InventoryListFilter {
  product_id?: number;
  warehouse_id?: number;
}

export interface MovementListFilter {
  product_id?: number;
  warehouse_id?: number;
  movement_type?: string;
}
