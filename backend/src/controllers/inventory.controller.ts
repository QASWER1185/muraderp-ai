import type { Request, Response } from "express";
import { InventoryService } from "../services/inventory.service.js";

export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  listBalances = async (request: Request, response: Response): Promise<void> => {
    const filter: { product_id?: number; warehouse_id?: number } = {};
    if (request.query.product_id !== undefined) filter.product_id = Number(request.query.product_id);
    if (request.query.warehouse_id !== undefined) filter.warehouse_id = Number(request.query.warehouse_id);
    const context = request.organizationContext!;
    const data = await this.service.listBalances(context.organizationId, filter);
    response.status(200).json({ success: true, data });
  };

  getBalance = async (request: Request, response: Response): Promise<void> => {
    const context = request.organizationContext!;
    const data = await this.service.getBalance(context.organizationId, Number(request.params.productId), Number(request.params.warehouseId));
    if (!data) {
      response.status(404).json({ error: { code: "INVENTORY_NOT_FOUND", message: "Inventory balance not found" } });
      return;
    }
    response.status(200).json({ success: true, data });
  };

  listMovements = async (request: Request, response: Response): Promise<void> => {
    const filter: { product_id?: number; warehouse_id?: number; movement_type?: string } = {};
    if (request.query.product_id !== undefined) filter.product_id = Number(request.query.product_id);
    if (request.query.warehouse_id !== undefined) filter.warehouse_id = Number(request.query.warehouse_id);
    if (typeof request.query.movement_type === "string") filter.movement_type = request.query.movement_type;
    const context = request.organizationContext!;
    const data = await this.service.listMovements(context.organizationId, context.branchId!, filter);
    response.status(200).json({ success: true, data });
  };
}
