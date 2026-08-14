import type { Request, Response } from "express";
import { ProductService } from "../services/product.service.js";

export class ProductController {
  constructor(private readonly service: ProductService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    const brandId = request.query.brand_id === undefined ? undefined : Number(request.query.brand_id);
    const products = await this.service.list({
      search: typeof request.query.search === "string" ? request.query.search : undefined,
      category: typeof request.query.category === "string" ? request.query.category : undefined,
      brand_id: brandId,
    });
    response.status(200).json({ success: true, data: products });
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    const product = await this.service.getById(Number(request.params.id));
    if (!product) {
      response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
      return;
    }
    response.status(200).json({ success: true, data: product });
  };

  create = async (request: Request, response: Response): Promise<void> => {
    const product = await this.service.create(request.body);
    response.status(201).json({ success: true, data: product });
  };

  update = async (request: Request, response: Response): Promise<void> => {
    const product = await this.service.update(Number(request.params.id), request.body);
    if (!product) {
      response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
      return;
    }
    response.status(200).json({ success: true, data: product });
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    const deleted = await this.service.delete(Number(request.params.id));
    if (!deleted) {
      response.status(404).json({ error: { code: "PRODUCT_NOT_FOUND", message: "Product not found" } });
      return;
    }
    response.status(204).send();
  };
}
