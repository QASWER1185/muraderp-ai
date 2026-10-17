import { describe, expect, it, vi } from "vitest";
import { InventoryService } from "./inventory.service.js";
import type { InventoryRepository } from "../repositories/inventory.repository.js";

const repository: InventoryRepository = {
  listBalances: vi.fn().mockResolvedValue([]),
  getBalance: vi.fn().mockResolvedValue(null),
  listMovements: vi.fn().mockResolvedValue([]),
};
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

describe("InventoryService", () => {
  it("rejects invalid balance filters", async () => {
    const service = new InventoryService(repository);
    await expect(service.listBalances(ORGANIZATION_ID, { product_id: 0 })).rejects.toThrow("product_id must be a positive integer");
    await expect(service.getBalance(ORGANIZATION_ID, 1, 0)).rejects.toThrow("warehouse_id must be a positive integer");
  });

  it("delegates valid balance reads", async () => {
    const service = new InventoryService(repository);
    await service.listBalances(ORGANIZATION_ID, { product_id: 10, warehouse_id: 2 });
    expect(repository.listBalances).toHaveBeenCalledWith(ORGANIZATION_ID, { product_id: 10, warehouse_id: 2 });
  });

  it("delegates movement reads and validates movement type", async () => {
    const service = new InventoryService(repository);
    await service.listMovements(ORGANIZATION_ID, BRANCH_ID, { warehouse_id: 2, movement_type: "PURCHASE" });
    expect(repository.listMovements).toHaveBeenCalledWith(ORGANIZATION_ID, BRANCH_ID, { warehouse_id: 2, movement_type: "PURCHASE" });
    await expect(service.listMovements(ORGANIZATION_ID, BRANCH_ID, { movement_type: "   " })).rejects.toThrow("movement_type cannot be empty");
  });
});
