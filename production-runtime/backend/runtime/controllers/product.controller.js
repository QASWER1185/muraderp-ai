export class ProductController {
    service;
    constructor(service) {
        this.service = service;
    }
    list = async (request, response) => {
        const filter = {};
        if (typeof request.query.search === "string" && request.query.search.trim() !== "")
            filter.search = request.query.search;
        if (typeof request.query.category === "string" && request.query.category.trim() !== "")
            filter.category = request.query.category;
        if (request.query.brand_id !== undefined)
            filter.brand_id = Number(request.query.brand_id);
        const products = await this.service.list(filter);
        response.status(200).json({ success: true, data: products });
    };
    getById = async (request, response) => {
        const product = await this.service.getById(Number(request.params.id));
        if (!product) {
            response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
            return;
        }
        response.status(200).json({ success: true, data: product });
    };
    create = async (request, response) => {
        const product = await this.service.create(request.body);
        response.status(201).json({ success: true, data: product });
    };
    update = async (request, response) => {
        const product = await this.service.update(Number(request.params.id), request.body);
        if (!product) {
            response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
            return;
        }
        response.status(200).json({ success: true, data: product });
    };
    delete = async (request, response) => {
        const deleted = await this.service.delete(Number(request.params.id));
        if (!deleted) {
            response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
            return;
        }
        response.status(204).send();
    };
}
//# sourceMappingURL=product.controller.js.map