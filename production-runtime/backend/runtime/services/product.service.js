function normalizeDefinition(input) {
    const name = input.name?.trim();
    const sku = input.sku?.trim();
    const category = input.category?.trim();
    const unit = input.unit?.trim();
    if (!name)
        throw new Error("name is required");
    if (!sku)
        throw new Error("sku is required");
    if (!category)
        throw new Error("category is required");
    if (!unit)
        throw new Error("unit is required");
    if (!Number.isFinite(input.purchase_price) || input.purchase_price < 0)
        throw new Error("purchase_price must be zero or greater");
    if (!Number.isFinite(input.sale_price) || input.sale_price < 0)
        throw new Error("sale_price must be zero or greater");
    if (input.brand_id != null && (!Number.isInteger(input.brand_id) || input.brand_id <= 0))
        throw new Error("brand_id must be a positive integer");
    return {
        name,
        sku,
        category,
        unit,
        purchase_price: input.purchase_price,
        sale_price: input.sale_price,
        brand_id: input.brand_id ?? null,
    };
}
export class ProductService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async create(input) {
        return this.repository.create(normalizeDefinition(input));
    }
    async getById(id) {
        if (!Number.isInteger(id) || id <= 0)
            throw new Error("id must be a positive integer");
        return this.repository.getById(id);
    }
    async list(filter = {}) {
        if (filter.brand_id != null && (!Number.isInteger(filter.brand_id) || filter.brand_id <= 0))
            throw new Error("brand_id must be a positive integer");
        const normalizedFilter = {};
        if (filter.search?.trim())
            normalizedFilter.search = filter.search.trim();
        if (filter.category?.trim())
            normalizedFilter.category = filter.category.trim();
        if (filter.brand_id !== undefined)
            normalizedFilter.brand_id = filter.brand_id;
        return this.repository.list(normalizedFilter);
    }
    async update(id, input) {
        if (!Number.isInteger(id) || id <= 0)
            throw new Error("id must be a positive integer");
        if (Object.keys(input).length === 0)
            throw new Error("at least one field is required");
        const normalized = normalizeDefinition({
            name: input.name ?? "placeholder",
            sku: input.sku ?? "placeholder",
            category: input.category ?? "placeholder",
            unit: input.unit ?? "placeholder",
            purchase_price: input.purchase_price ?? 0,
            sale_price: input.sale_price ?? 0,
            brand_id: input.brand_id ?? null,
        });
        const partial = {};
        if (input.name !== undefined)
            partial.name = normalized.name;
        if (input.sku !== undefined)
            partial.sku = normalized.sku;
        if (input.category !== undefined)
            partial.category = normalized.category;
        if (input.unit !== undefined)
            partial.unit = normalized.unit;
        if (input.purchase_price !== undefined)
            partial.purchase_price = normalized.purchase_price;
        if (input.sale_price !== undefined)
            partial.sale_price = normalized.sale_price;
        if (input.brand_id !== undefined)
            partial.brand_id = input.brand_id;
        return this.repository.update(id, partial);
    }
    async delete(id) {
        if (!Number.isInteger(id) || id <= 0)
            throw new Error("id must be a positive integer");
        return this.repository.delete(id);
    }
}
//# sourceMappingURL=product.service.js.map