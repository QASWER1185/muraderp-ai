export class InventoryController {
    service;
    constructor(service) {
        this.service = service;
    }
    listBalances = async (request, response) => {
        const filter = {};
        if (request.query.product_id !== undefined)
            filter.product_id = Number(request.query.product_id);
        if (request.query.warehouse_id !== undefined)
            filter.warehouse_id = Number(request.query.warehouse_id);
        const context = request.organizationContext;
        const data = await this.service.listBalances(context.organizationId, filter);
        response.status(200).json({ success: true, data });
    };
    getBalance = async (request, response) => {
        const context = request.organizationContext;
        const data = await this.service.getBalance(context.organizationId, Number(request.params.productId), Number(request.params.warehouseId));
        if (!data) {
            response.status(404).json({ error: { code: "INVENTORY_NOT_FOUND", message: "Inventory balance not found" } });
            return;
        }
        response.status(200).json({ success: true, data });
    };
    listMovements = async (request, response) => {
        const filter = {};
        if (request.query.product_id !== undefined)
            filter.product_id = Number(request.query.product_id);
        if (request.query.warehouse_id !== undefined)
            filter.warehouse_id = Number(request.query.warehouse_id);
        if (typeof request.query.movement_type === "string")
            filter.movement_type = request.query.movement_type;
        const context = request.organizationContext;
        const data = await this.service.listMovements(context.organizationId, context.branchId, filter);
        response.status(200).json({ success: true, data });
    };
}
//# sourceMappingURL=inventory.controller.js.map