import type { InventoryRepository } from "../repositories/inventory.repository.js";
import type { InventoryBalance, InventoryListFilter, InventoryMovement, MovementListFilter } from "../types/inventory.types.js";

function validateId(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

export class InventoryService {
  constructor(private readonly repository: InventoryRepository) {}

  async listBalances(filter: InventoryListFilter = {}): Promise<InventoryBalance[]> {
    if (filter.product_id !== undefined) validateId(filter.product_id, "product_id");
    if (filter.warehouse_id !== undefined) validateId(filter.warehouse_id, "warehouse_id");
    return this.repository.listBalances(filter);
  }

  async getBalance(productId: number, warehouseId: number): Promise<InventoryBalance | null> {
    validateId(productId, "product_id");
    validateId(warehouseId, "warehouse_id");
    return this.repository.getBalance(productId, warehouseId);
  }

  async listMovements(filter: MovementListFilter = {}): Promise<InventoryMovement[]> {
    if (filter.product_id !== undefined) validateId(filter.product_id, "product_id");
    if (filter.warehouse_id !== undefined) validateId(filter.warehouse_id, "warehouse_id");
    if (filter.movement_type !== undefined && !filter.movement_type.trim()) throw new Error("movement_type cannot be empty");
    return this.repository.listMovements(filter);
  }
}
