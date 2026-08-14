import { describe, expect, it, vi } from "vitest";
import { InventoryService } from "./inventory.service.js";
import type { InventoryRepository } from "../repositories/inventory.repository.js";

const repository: InventoryRepository = {
  listBalances: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(null),
  listMovements: vi.fn().mockResolvedValue([]),
};

describe("InventoryService", () => {
  it("rejects invalid balance filters", async () => {
    const service = new InventoryService(repository);
    await expect(service.listBalances({ product_id: 0 })).rejects.toThrow("product_id must be a positive integer");
    await expect(service.getBalance(1, 0)).rejects.toThrow("warehouse_id must be a positive integer");
  });

  it("delegates valid balance reads", async () => {
    const service = new InventoryService(repository);
    await service.listBalances({ product_id: 10, warehouse_id: 2 });
    expect(repository.listBalances).toHaveBeenCalledWith({ product_id: 10, warehouse_id: 2 });
  });

  it("delegates movement reads and validates movement type", async () => {
    const service = new InventoryService(repository);
    await service.listMovements({ warehouse_id: 2, movement_type: "PURCHASE" });
    expect(repository.listMovements).toHaveBeenCalledWith({ warehouse_id: 2, movement_type: "PURCHASE" });
    await expect(service.listMovements({ movement_type: "   " })).rejects.toThrow("movement_type cannot be empty");
  });
});
