function validateId(value, name) {
    if (!Number.isInteger(value) || value <= 0)
        throw new Error(`${name} must be a positive integer`);
}
export class InventoryService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listBalances(organizationId, filter = {}) {
        if (filter.product_id !== undefined)
            validateId(filter.product_id, "product_id");
        if (filter.warehouse_id !== undefined)
            validateId(filter.warehouse_id, "warehouse_id");
        return this.repository.listBalances(organizationId, filter);
    }
    async getBalance(organizationId, productId, warehouseId) {
        validateId(productId, "product_id");
        validateId(warehouseId, "warehouse_id");
        return this.repository.getBalance(organizationId, productId, warehouseId);
    }
    async listMovements(organizationId, branchId, filter = {}) {
        if (filter.product_id !== undefined)
            validateId(filter.product_id, "product_id");
        if (filter.warehouse_id !== undefined)
            validateId(filter.warehouse_id, "warehouse_id");
        if (filter.movement_type !== undefined && !filter.movement_type.trim())
            throw new Error("movement_type cannot be empty");
        return this.repository.listMovements(organizationId, branchId, filter);
    }
}
//# sourceMappingURL=inventory.service.js.map